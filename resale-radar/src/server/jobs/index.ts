import "server-only";
import os from "node:os";
import { asService, withOwner, type Queryable } from "@/server/db";
import { logger } from "@/server/log";
import { checkInventoryAging } from "@/server/services/inventory";
import { runWatchlist } from "@/server/services/automation";
import { dispatchNotifications } from "./notify";

/**
 * Postgres-backed job queue. Jobs are idempotent by key, claimed with
 * SKIP LOCKED, retried with exponential backoff, and parked as "dead" after
 * max attempts. Works from a long-running worker or a bounded cron tick.
 */

export type JobKind = "watchlist.run" | "inventory.aging" | "notifications.dispatch";

export async function enqueue(q: Queryable, ownerId: string | null, kind: JobKind, payload: Record<string, unknown>, idempotencyKey: string | null, runAfter?: Date) {
  await q.query(
    `insert into background_jobs (owner_id, kind, payload, idempotency_key, run_after) values ($1,$2,$3,$4,$5) on conflict (idempotency_key) do nothing`,
    [ownerId, kind, payload, idempotencyKey, (runAfter ?? new Date()).toISOString()],
  );
}

const HANDLERS: Record<JobKind, (q: Queryable, ownerId: string, payload: Record<string, unknown>) => Promise<unknown>> = {
  "watchlist.run": (q, ownerId, p) => runWatchlist(q, ownerId, String(p.profileId)),
  "inventory.aging": (q, ownerId) => checkInventoryAging(q, ownerId),
  "notifications.dispatch": (q, ownerId) => dispatchNotifications(q, ownerId),
};

/** Enqueue recurring work that is due. Safe to call every minute: idempotency keys collapse duplicates. */
export async function scheduleDueWork(now = new Date()) {
  await asService(async (q) => {
    const owners = await q.query<{ owner_id: string }>(`select owner_id from application_settings where onboarding_completed`);
    for (const { owner_id } of owners) {
      const profiles = await q.query<{ id: string; poll_minutes: number; last: Date | null }>(
        `select p.id, p.poll_minutes, (select max(started_at) from search_executions e where e.search_profile_id = p.id) as last
           from search_profiles p where p.owner_id = $1 and p.active and 'ebay' = any(p.sources)`,
        [owner_id],
      );
      for (const p of profiles) {
        const due = !p.last || now.getTime() - new Date(p.last).getTime() >= Number(p.poll_minutes) * 60_000;
        if (due) {
          const slot = Math.floor(now.getTime() / (Number(p.poll_minutes) * 60_000));
          await enqueue(q, owner_id, "watchlist.run", { profileId: p.id }, `watchlist:${p.id}:${slot}`);
        }
      }
      await enqueue(q, owner_id, "inventory.aging", {}, `aging:${owner_id}:${now.toISOString().slice(0, 10)}`);
      await enqueue(q, owner_id, "notifications.dispatch", {}, `notify:${owner_id}:${Math.floor(now.getTime() / 60_000)}`);
    }
  });
}

export async function processJobs(maxJobs = 10, workerId = `${os.hostname()}:${process.pid}`): Promise<number> {
  let processed = 0;
  for (; processed < maxJobs; ) {
    const job = await asService(async (q) => {
      const [j] = await q.query<{ id: string; owner_id: string | null; kind: JobKind; payload: Record<string, unknown>; attempts: number; max_attempts: number }>(
        `update background_jobs set status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1
          where id = (select id from background_jobs where status in ('queued','failed') and run_after <= now() order by run_after limit 1 for update skip locked)
          returning id, owner_id, kind, payload, attempts, max_attempts`,
        [workerId],
      );
      return j ?? null;
    });
    if (!job) break;
    processed++;
    const started = Date.now();
    try {
      const handler = HANDLERS[job.kind];
      if (!handler || !job.owner_id) throw new Error(`No handler for ${job.kind}`);
      await withOwner(job.owner_id, (q) => handler(q, job.owner_id!, job.payload));
      await asService((q) => q.query(`update background_jobs set status = 'succeeded', finished_at = now(), last_error = null where id = $1`, [job.id]));
      logger.info("job.succeeded", { kind: job.kind, ms: Date.now() - started });
    } catch (e) {
      const dead = job.attempts >= job.max_attempts;
      const backoffSec = Math.min(3600, 30 * 2 ** (job.attempts - 1));
      await asService((q) =>
        q.query(`update background_jobs set status = $2, last_error = $3, run_after = now() + ($4 || ' seconds')::interval where id = $1`, [
          job.id, dead ? "dead" : "failed", (e as Error).message.slice(0, 1000), String(backoffSec),
        ]),
      );
      logger.warn("job.failed", { kind: job.kind, attempts: job.attempts, dead, error: (e as Error).message });
    }
  }
  return processed;
}
