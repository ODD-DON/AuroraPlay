/** Applies supabase/migrations to DATABASE_URL (or the local embedded database). */
import { getDb, runMigrations } from "../src/server/db";

const db = await getDb();
const applied = await runMigrations(db);
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
await db.close();
