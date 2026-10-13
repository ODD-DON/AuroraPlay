import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isLocalMode, LOCAL_OWNER_ID } from "@/server/db";

/**
 * Resolves the signed-in owner.
 * Local mode (no DATABASE_URL) is a single-owner development workspace.
 * Supabase mode requires a valid Supabase Auth session.
 */
export async function getOwnerId(): Promise<string> {
  if (isLocalMode()) return LOCAL_OWNER_ID;
  const user = await getSupabaseUser();
  if (!user) redirect("/login");
  return user.id;
}

export function supabaseConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export async function getSupabaseServerClient() {
  if (!supabaseConfigured()) return null;
  const { createServerClient } = await import("@supabase/ssr");
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) store.set(c.name, c.value, c.options);
        } catch {
          // Server components cannot set cookies; middleware refreshes the session.
        }
      },
    },
  });
}

async function getSupabaseUser() {
  const client = await getSupabaseServerClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user ?? null;
}
