import { BrainCircuit, ChartLine, Coins, Radar, ShoppingBag } from "lucide-react";
import { MonthlyProfitChart } from "@/components/charts";
import { Money } from "@/components/domain";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { formatCents } from "@/domain/money";
import { CATEGORY_LABELS } from "@/domain/settings";
import { asOwner } from "@/server/auth";
import { getSettings, monthToDateUsage } from "@/server/services/core";
import { getAnalytics } from "@/server/services/planning";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v === null ? "Unknown" : `${Math.round(v * 100)}%`);

export default async function AnalyticsPage() {
  const { a, usage, budget } = await asOwner(async (q, o) => ({ a: await getAnalytics(q, o), usage: await monthToDateUsage(q, o), budget: (await getSettings(q, o)).settings.monthlySoftwareBudgetCents }));
  const s = a.sourcing;
  const totalUsageCents = Math.round(usage.reduce((x, u) => x + u.costMicrodollars, 0) / 10_000);
  const aiTotal = a.ai.correct + a.ai.incorrect;
  return (
    <div className="flex flex-col gap-5 animate-in">
      <PageHeader icon={<ChartLine />} title="Analytics" description="Performance from real outcomes. Predictions are compared with what actually happened." />

      <Card>
        <CardHeader icon={<Radar />} title="Sourcing" />
        <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Discovered" value={s.discovered ?? 0} />
          <Stat label="Qualified" value={s.qualified ?? 0} />
          <Stat label="Strong buy" value={s.strong_buy ?? 0} />
          <Stat label="Worth the drive" value={s.worth_drive ?? 0} />
          <Stat label="Hidden gems" value={s.hidden_gem ?? 0} />
          <Stat label="Purchased" value={s.purchased ?? 0} />
          <Stat label="Missed (sold to others)" value={s.missed ?? 0} />
          <Stat label="Offers made" value={a.offers.made} />
          <Stat label="Accepted" value={a.offers.accepted} />
          <Stat label="Rejected" value={a.offers.rejected} />
          <Stat label="Avg. discount negotiated" value={pct(a.offers.avgDiscount)} />
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader icon={<ShoppingBag />} title="Realized profit by month" />
          <CardBody><MonthlyProfitChart data={a.monthly} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Sales" />
          <CardBody className="grid grid-cols-2 gap-4">
            <Stat label="Units sold" value={a.sales.units} />
            <Stat label="Revenue" value={formatCents(a.sales.revenueCents)} />
            <Stat label="Realized profit" value={<Money cents={a.sales.profitCents} colored />} />
            <Stat label="Average ROI" value={pct(a.sales.avgRoi)} />
            <Stat label="Median days to sell" value={a.sales.medianDays ?? "Unknown"} />
            <Stat label="Loss-making sales" value={a.sales.losses} tone={a.sales.losses ? "negative" : undefined} />
            <Stat label="Avg. label vs estimate" value={a.shippingErrorCents === null ? "Unknown" : formatCents(a.shippingErrorCents, { sign: true })} />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profit by category" />
          {a.byCategory.length === 0 ? <EmptyState title="No sales yet" /> : (
            <Table>
              <thead><tr><Th>Category</Th><Th className="text-right">Units</Th><Th className="text-right">Profit</Th><Th className="text-right">ROI</Th></tr></thead>
              <tbody>{a.byCategory.map((c) => <tr key={c.category}><Td>{CATEGORY_LABELS[c.category] ?? c.category}</Td><Td className="text-right tabular">{c.units}</Td><Td className="text-right"><Money cents={c.profitCents} colored /></Td><Td className="text-right tabular">{pct(c.roi)}</Td></tr>)}</tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Predicted vs actual" description="Base-case predictions at the time of purchase." />
          {a.accuracy.length === 0 ? <EmptyState title="Appears after your first sale" /> : (
            <Table>
              <thead><tr><Th>Item</Th><Th className="text-right">Pred. price</Th><Th className="text-right">Actual</Th><Th className="text-right">Pred. profit</Th><Th className="text-right">Actual</Th><Th className="text-right">Days</Th></tr></thead>
              <tbody>
                {a.accuracy.map((r, i) => (
                  <tr key={i}>
                    <Td className="max-w-[160px] truncate">{r.name}</Td>
                    <Td className="text-right"><Money cents={r.predictedCents} /></Td>
                    <Td className="text-right"><Money cents={r.actualCents} /></Td>
                    <Td className="text-right"><Money cents={r.predictedProfitCents} /></Td>
                    <Td className="text-right"><Money cents={r.actualProfitCents} colored /></Td>
                    <Td className="text-right tabular">{r.actualDays ?? ""}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<BrainCircuit />} title="AI performance" description="From your confirmations and rejections of AI hypotheses." />
          <CardBody className="grid grid-cols-3 gap-4">
            <Stat label="Correct identifications" value={a.ai.correct} />
            <Stat label="Incorrect" value={a.ai.incorrect} />
            <Stat label="Accuracy" value={aiTotal ? `${Math.round((a.ai.correct / aiTotal) * 100)}%` : "Unknown"} />
          </CardBody>
          <p className="px-4 pb-4 text-xs text-fg-muted sm:px-5">Recommendations currently use transparent rules. Statistical models will only be introduced once there is enough clean outcome history to train and validate them.</p>
        </Card>
        <Card>
          <CardHeader icon={<Coins />} title="Software and API costs (this month)" description={`${formatCents(totalUsageCents)} of ${formatCents(budget)} budget. Included in Financials as software expense when you record it.`} />
          {usage.length === 0 ? <EmptyState title="No paid API usage this month" /> : (
            <Table>
              <thead><tr><Th>Provider</Th><Th className="text-right">Calls</Th><Th className="text-right">Cost</Th></tr></thead>
              <tbody>{usage.map((u) => <tr key={u.provider}><Td>{u.provider}</Td><Td className="text-right tabular">{u.calls}</Td><Td className="text-right tabular">{formatCents(Math.round(u.costMicrodollars / 10_000))}</Td></tr>)}</tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
