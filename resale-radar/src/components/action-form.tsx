"use client";

import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, cn, type buttonVariants } from "./ui";
import type { VariantProps } from "class-variance-authority";

export interface ActionResult {
  ok: boolean;
  message?: string;
  error?: string;
  redirectTo?: string;
  data?: unknown;
}

export type FormAction = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

export function SubmitButton({ children, pendingLabel, ...props }: { children: ReactNode; pendingLabel?: string } & VariantProps<typeof buttonVariants> & { className?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} {...props}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? pendingLabel ?? "Saving" : children}
    </Button>
  );
}

/** Form bound to a server action, with pending state and inline success or error feedback. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  onSuccess,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (r: ActionResult) => void;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
      if (state.redirectTo) window.location.assign(state.redirectTo);
    }
  }, [state, resetOnSuccess, onSuccess]);
  return (
    <form ref={ref} action={formAction} className={cn("flex flex-col gap-3", className)}>
      {children}
      <FormMessage state={state} />
    </form>
  );
}

export function FormMessage({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  if (state.ok && !state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={cn("flex items-start gap-1.5 text-xs animate-in", state.ok ? "text-positive" : "text-negative")}>
      {state.ok ? <CircleCheck className="mt-px size-3.5 shrink-0" /> : <CircleAlert className="mt-px size-3.5 shrink-0" />}
      {state.ok ? state.message : state.error}
    </p>
  );
}
