import { Radar } from "lucide-react";
import { redirect } from "next/navigation";
import { Card, CardBody } from "@/components/ui";
import { supabaseConfigured } from "@/server/auth";
import { isLocalMode } from "@/server/db";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  if (isLocalMode()) redirect("/");
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardBody className="flex flex-col gap-5 py-6">
          <div className="flex items-center gap-2 font-semibold"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-fg"><Radar className="size-4" /></span>Resale Radar</div>
          {supabaseConfigured() ? (
            <LoginForm url={process.env.NEXT_PUBLIC_SUPABASE_URL!} anonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!} />
          ) : (
            <p className="text-sm text-fg-muted">Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
