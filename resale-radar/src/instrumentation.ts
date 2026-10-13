/**
 * Local mode runs the scheduler inside the web server process, because the embedded
 * database allows a single process. Production uses scripts/worker.ts or /api/cron/tick.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DATABASE_URL || process.env.RR_INPROCESS_WORKER === "0" || process.env.NODE_ENV === "test") return;
  const { scheduleDueWork, processJobs } = await import("@/server/jobs");
  const { logger } = await import("@/server/log");
  const tick = async () => {
    try {
      await scheduleDueWork();
      await processJobs(10, "in-process");
    } catch (e) {
      logger.warn("scheduler.tick_failed", { error: (e as Error).message });
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, 60_000);
}
