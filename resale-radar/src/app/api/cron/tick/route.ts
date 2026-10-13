import { processJobs, scheduleDueWork } from "@/server/jobs";
import { logger } from "@/server/log";

/**
 * Scheduler endpoint for Vercel Cron or any external scheduler.
 * Requires CRON_SECRET as a bearer token. Processes a bounded batch so it fits serverless limits.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const started = Date.now();
  await scheduleDueWork();
  const processed = await processJobs(15);
  logger.info("cron.tick", { processed, ms: Date.now() - started });
  return Response.json({ processed });
}
