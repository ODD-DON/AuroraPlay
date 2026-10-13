"use client";

import { createBrowserClient } from "@supabase/ssr";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";

export function LoginForm({ url, anonKey }: { url: string; anonKey: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const supabase = createBrowserClient(url, anonKey);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message });
    else window.location.assign("/");
  }

  async function magicLink() {
    if (!email) return setMsg({ ok: false, text: "Enter your email first." });
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Check your email for a sign-in link." });
  }

  return (
    <form onSubmit={signIn} className="flex flex-col gap-3">
      <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Button type="submit" variant="primary" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : null}Sign in</Button>
      <Button type="button" variant="ghost" onClick={magicLink} disabled={busy}>Email me a sign-in link</Button>
      {msg ? <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-xs text-positive" : "text-xs text-negative"}>{msg.text}</p> : null}
    </form>
  );
}
