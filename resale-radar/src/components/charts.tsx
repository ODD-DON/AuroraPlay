"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { formatCents } from "@/domain/money";

/** Single series: realized profit per month. Sign is encoded by color and the tooltip label, never color alone. */
export function MonthlyProfitChart({ data }: { data: { month: string; profitCents: number; units: number }[] }) {
  if (!data.length) return <p className="py-8 text-center text-sm text-fg-muted">No realized sales yet.</p>;
  return (
    <div className="h-56 w-full" role="img" aria-label="Realized profit by month">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: "var(--fg-subtle)", fontSize: 11 }} />
          <YAxis tickLine={false} axisLine={false} width={56} tick={{ fill: "var(--fg-subtle)", fontSize: 11 }} tickFormatter={(v: number) => formatCents(v, { compact: true })} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--fg)" }}
            formatter={(v, _n, item) => [`${formatCents(Number(v))} (${(item?.payload as { units: number })?.units ?? 0} sold)`, Number(v) >= 0 ? "Profit" : "Loss"]}
            labelStyle={{ color: "var(--fg-muted)" }}
          />
          <Bar dataKey="profitCents" radius={[4, 4, 0, 0]} maxBarSize={36}>
            {data.map((d) => <Cell key={d.month} fill={d.profitCents >= 0 ? "var(--positive)" : "var(--negative)"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
