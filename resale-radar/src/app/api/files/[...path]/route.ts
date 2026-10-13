import { getOwnerIdOrNull } from "@/server/auth";
import { readObject } from "@/server/storage";

/** Serves stored images only to their owner. Paths are <ownerId>/<uuid>.jpg. */
export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const owner = await getOwnerIdOrNull();
  const storagePath = path.join("/");
  if (!owner || path.length !== 2 || path[0] !== owner) return new Response("Not found", { status: 404 });
  try {
    const data = await readObject(storagePath);
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
