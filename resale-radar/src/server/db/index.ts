import "server-only";
import fs from "node:fs";
import path from "node:path";
import { logger } from "@/server/log";

/**
 * Database access. Two drivers behind one interface:
 *  - Production: Supabase Postgres via DATABASE_URL (postgres.js).
 *  - Local: embedded Postgres (PGlite) persisted under .data/, so the app runs with no credentials.
 *
 * All application queries go through `withOwner`, which opens a transaction,
 * sets the JWT claims, and switches to the `authenticated` role so row-level
 * security is enforced even for server-side code.
 */

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run a multi-statement script with no parameters (migrations only). */
  exec(sql: string): Promise<void>;
}

export interface Database extends Queryable {
  driver: "postgres" | "pglite";
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export const LOCAL_OWNER_ID = "00000000-0000-4000-8000-000000000001";

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const SHIM_DIR = path.join(ROOT, "src", "server", "db");

/**
 * Arrays bind as Postgres arrays (text[] columns). Plain objects bind as JSON text for jsonb columns.
 * To store a JSON array in a jsonb column, pass JSON.stringify(value) explicitly.
 */
function normalizeParams(params: unknown[] = []): unknown[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (p === null || typeof p !== "object" || p instanceof Date || Array.isArray(p)) return p;
    return JSON.stringify(p);
  });
}

async function createPostgres(url: string): Promise<Database> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 5, idle_timeout: 20, prepare: false, types: { bigint: postgres.BigInt } });
  const wrap = (run: (text: string, params?: unknown[]) => Promise<unknown>): Queryable => ({
    async query<T extends Row>(text: string, params?: unknown[]) {
      return (await run(text, normalizeParams(params))) as T[];
    },
    async exec(text: string) {
      await run(text);
    },
  });
  const base = wrap((t, p) => (p ? sql.unsafe(t, p as never[]) : sql.unsafe(t)));
  return {
    driver: "postgres",
    query: base.query,
    exec: base.exec,
    async transaction(fn) {
      return (await sql.begin(async (tx) => fn(wrap((t, p) => (p ? tx.unsafe(t, p as never[]) : tx.unsafe(t)))))) as never;
    },
    close: () => sql.end(),
  };
}

async function createPglite(dataDir: string | null): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  type Conn = { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (t: string) => Promise<unknown> };
  const wrap = (q: Conn): Queryable => ({
    async query<T extends Row>(text: string, params?: unknown[]) {
      return (await q.query(text, normalizeParams(params))).rows as T[];
    },
    async exec(text: string) {
      await q.exec(text);
    },
  });
  const base = wrap(pg);
  // PGlite is single-connection; serialize transactions to keep them isolated.
  let chain: Promise<unknown> = Promise.resolve();
  return {
    driver: "pglite",
    query: base.query,
    exec: base.exec,
    transaction(fn) {
      const run = chain.then(() => pg.transaction(async (tx) => fn(wrap(tx))));
      chain = run.catch(() => undefined);
      return run;
    },
    close: () => pg.close(),
  };
}

export async function runMigrations(db: Database): Promise<string[]> {
  const applied: string[] = [];
  if (db.driver === "pglite") {
    await db.exec(fs.readFileSync(path.join(SHIM_DIR, "local-auth-shim.sql"), "utf8"));
  }
  await db.query(`create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ name: string }>(`select name from public._migrations`)).map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    await db.transaction(async (q) => {
      await q.exec(sql);
      await q.query(`insert into public._migrations (name) values ($1)`, [file]);
    });
    applied.push(file);
  }
  if (db.driver === "pglite") {
    await db.exec(fs.readFileSync(path.join(SHIM_DIR, "local-grants.sql"), "utf8"));
    await db.query(`insert into auth.users (id, email) values ($1, 'owner@local') on conflict do nothing`, [LOCAL_OWNER_ID]);
  }
  if (applied.length) logger.info("db.migrations_applied", { applied });
  return applied;
}

type GlobalDb = { __rrDb?: Promise<Database> };
const g = globalThis as GlobalDb;

export function isLocalMode(): boolean {
  return !process.env.DATABASE_URL;
}

export function getDb(): Promise<Database> {
  if (!g.__rrDb) {
    g.__rrDb = (async () => {
      const db = process.env.DATABASE_URL
        ? await createPostgres(process.env.DATABASE_URL)
        : await createPglite(process.env.RR_PGLITE_DIR === ":memory:" ? null : process.env.RR_PGLITE_DIR ?? path.join(ROOT, ".data", "pglite"));
      if (db.driver === "pglite" || process.env.RR_AUTO_MIGRATE === "1") await runMigrations(db);
      return db;
    })();
    g.__rrDb.catch(() => {
      g.__rrDb = undefined;
    });
  }
  return g.__rrDb;
}

/** Run `fn` inside a transaction scoped to one owner with row-level security enforced. */
export async function withOwner<T>(ownerId: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(ownerId)) throw new Error("Invalid owner id");
  const db = await getDb();
  return db.transaction(async (q) => {
    await q.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ownerId, role: "authenticated" })]);
    await q.query(`set local role authenticated`);
    return fn(q);
  });
}

/** Service-level access for the background worker. Callers must scope every query by owner_id. */
export async function asService<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}

export function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "bigint") return Number(v);
  return Number(v);
}

export function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : num(v);
}
