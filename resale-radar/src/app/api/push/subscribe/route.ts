import { z } from "zod";
import { getOwnerIdOrNull } from "@/server/auth";
import { withOwner } from "@/server/db";

const schema = z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });

export async function GET() {
  return Response.json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null });
}

export async function POST(req: Request) {
  const owner = await getOwnerIdOrNull();
  if (!owner) return new Response("Unauthorized", { status: 401 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return new Response("Forbidden", { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid subscription", { status: 400 });
  await withOwner(owner, (q) =>
    q.query(`insert into push_subscriptions (owner_id, endpoint, keys) values ($1,$2,$3) on conflict (endpoint) do update set keys = excluded.keys`, [owner, parsed.data.endpoint, parsed.data.keys]),
  );
  return Response.json({ ok: true });
}
