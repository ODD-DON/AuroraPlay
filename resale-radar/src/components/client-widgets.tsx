"use client";

import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { profitAtPrice, type Evaluation } from "@/domain/evaluate";
import { dollarsToCents, formatBps, formatCents } from "@/domain/money";
import { Button, cn, Input } from "./ui";

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          window.prompt("Copy this text:", text);
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** "What if I pay X?" Deterministic: profit moves one-for-one with price for private-party purchases. */
export function PriceCalculator({ evaluation, askingCents, maxCents }: { evaluation: Evaluation; askingCents: number; maxCents: number | null }) {
  const [value, setValue] = useState(((maxCents ?? askingCents) / 100).toFixed(0));
  const rows = useMemo(() => {
    try {
      const cents = dollarsToCents(value || "0");
      return { cents, rows: profitAtPrice(evaluation, askingCents, cents) };
    } catch {
      return null;
    }
  }, [value, evaluation, askingCents]);
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-fg-muted" htmlFor="alt-price">If I pay</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-subtle">$</span>
        <Input id="alt-price" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="pl-6 tabular" />
      </div>
      {rows?.rows ? (
        <div className="grid grid-cols-3 gap-2 text-xs">
          {rows.rows.map((r) => (
            <div key={r.name} className="rounded-md border border-border bg-bg-subtle p-2">
              <div className="capitalize text-fg-subtle">{r.name}</div>
              <div className={cn("font-semibold tabular", r.netProfitCents >= 0 ? "text-positive" : "text-negative")}>{formatCents(r.netProfitCents)}</div>
              <div className="tabular text-fg-muted">{formatBps(r.cashRoiBps)}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-fg-subtle">Needs sold comparables to calculate.</p>
      )}
      {maxCents !== null && rows && rows.cents > maxCents ? <p className="text-xs text-negative">Above your maximum of {formatCents(maxCents)}.</p> : null}
    </div>
  );
}

/** A disclosure whose open state survives server re-renders (unlike <details open={...}>). */
export function Disclosure({ summary, defaultOpen = false, children, className }: { summary: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 text-left text-sm font-medium">
        <span className={cn("inline-block text-fg-subtle transition-transform", open && "rotate-90")} aria-hidden>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </span>
        {summary}
      </button>
      {open ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
