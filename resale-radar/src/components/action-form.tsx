"use client";

import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
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

const PendingContext = createContext(false);

export function SubmitButton({ children, pendingLabel, ...props }: { children: ReactNode; pendingLabel?: string } & VariantProps<typeof buttonVariants> & { className?: string; name?: string; value?: string }) {
  const status = useFormStatus();
  const pending = useContext(PendingContext) || status.pending;
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} {...props}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? pendingLabel ?? "Saving" : children}
    </Button>
  );
}

/**
 * Form bound to a server action, with pending state and inline success or error feedback.
 * Submits through onSubmit instead of the `action` prop so React does not reset the fields
 * to their old defaults after a save; the submitter's name and value are included.
 */
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
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
      if (state.redirectTo) window.location.assign(state.redirectTo);
    }
  }, [state, resetOnSuccess, onSuccess]);
  return (
    <PendingContext.Provider value={pending}>
      <form
        ref={ref}
        className={cn("flex flex-col gap-3", className)}
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
          startTransition(() => formAction(fd));
        }}
      >
        {children}
        <FormMessage state={state} />
      </form>
    </PendingContext.Provider>
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
