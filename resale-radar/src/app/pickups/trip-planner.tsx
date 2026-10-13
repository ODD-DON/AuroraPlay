"use client";

import { useState } from "react";
import { planTripAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Input } from "@/components/ui";
import { formatCents } from "@/domain/money";

export function TripPlanner({ candidates }: { candidates: { id: string; title: string; minutes: number; net: number | null }[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const pairs: [string, string][] = [];
  for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) pairs.push([selected[i]!, selected[j]!]);
  const title = (id: string) => candidates.find((c) => c.id === id)?.title ?? id;
  return (
    <ActionForm action={planTripAction}>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs font-medium text-fg-muted">Choose up to 7 deals</legend>
        {candidates.map((c) => (
          <label key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                name="opportunityIds"
                value={c.id}
                className="size-4 accent-[var(--accent)]"
                checked={selected.includes(c.id)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id].slice(0, 7) : s.filter((x) => x !== c.id)))}
              />
              {c.title}
            </span>
            <span className="text-xs text-fg-muted">{c.minutes} min · net {formatCents(c.net)}</span>
          </label>
        ))}
      </fieldset>
      {pairs.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-fg-muted">Drive time between stops (from your maps app). Straight-line distance is never used.</p>
          {pairs.map(([a, b]) => {
            const key = [a, b].sort().join(":");
            return (
              <div key={key} className="grid grid-cols-[1fr_90px_90px] items-center gap-2 text-sm">
                <span className="truncate text-fg-muted">{title(a)} to {title(b)}</span>
                <Input name={`leg_min_${key}`} type="number" min="0" placeholder="min" required aria-label="Minutes" />
                <Input name={`leg_mi_${key}`} type="number" min="0" step="0.1" placeholder="miles" required aria-label="Miles" />
              </div>
            );
          })}
        </div>
      ) : null}
      <Input name="name" placeholder="Trip name (optional)" />
      <div><SubmitButton variant="primary" size="sm" pendingLabel="Optimizing">Plan trip</SubmitButton></div>
    </ActionForm>
  );
}
