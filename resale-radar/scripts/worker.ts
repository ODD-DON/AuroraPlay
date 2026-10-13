/**
 * Long-running background worker for production (Railway, Fly.io, Render, a VPS).
 * Usage: DATABASE_URL=... npm run worker
 */
import { processJobs, scheduleDueWork } from "../src/server/jobs";
import { logger } from "../src/server/log";

let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the standalone worker. Local mode runs jobs inside the web server.");
  let lastSchedule = 0;
  while (!stopping) {
    if (Date.now() - lastSchedule > 60_000) {
      await scheduleDueWork().catch((e) => logger.error("worker.schedule_failed", { error: (e as Error).message }));
      lastSchedule = Date.now();
    }
    const n = await processJobs(20).catch((e) => (logger.error("worker.process_failed", { error: (e as Error).message }), 0));
    if (n === 0) await new Promise((r) => setTimeout(r, 5_000));
  }
  logger.info("worker.stopped");
  process.exit(0);
}

main();
