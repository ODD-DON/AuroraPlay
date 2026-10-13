"use client";

import { useMemo, useState } from "react";
import { DecisionBadge } from "@/components/domain";
import { Card, CardBody, CardHeader, Field, Input, KeyValue, Notice, Select } from "@/components/ui";
import { evaluateOpportunity, type OpportunityInput } from "@/domain/evaluate";
import { dollarsToCents, formatBps, formatCents } from "@/domain/money";
import { CATEGORY_LABELS, type BusinessSettings } from "@/domain/settings";

function cents(v: string): number | null {
  if (!v.trim()) return null;
  try {
    return dollarsToCents(v);
  } catch {
    return null;
  }
}

export function AnalyzerForm({ settings, buyingPowerCents }: { settings: BusinessSettings; buyingPowerCents: number | null }) {
  const [f, setF] = useState({
    asking: "200",
    low: "",
    median: "320",
    high: "",
    soldCount: "20",
    activeCount: "15",
    category: "game_consoles",
    channel: "ebay_us",
    label: "18",
    minutes: "15",
    miles: "9",
    shipped: false,
    verified: true,
    tested: true,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  const ev = useMemo(() => {
    const asking = cents(f.asking);
    const median = cents(f.median);
    if (asking === null || median === null) return null;
    const low = cents(f.low) ?? Math.round(median * 0.88);
    const high = cents(f.high) ?? Math.round(median * 1.1);
    const now = new Date();
    // Synthesize a small, symmetric comp set from the range you entered so the engine can apply its rules.
    const prices = [low, Math.round((low + median) / 2), median, median, Math.round((median + high) / 2), high];
    const input: OpportunityInput = {
      askingPriceCents: asking,
      category: f.category,
      listingAvailable: true,
      identity: { status: f.verified ? "verified" : "unverified", confidence: f.verified ? 0.95 : 0.5 },
      authenticity: f.verified ? "not_required" : "unverified",
      conditionConfidence: 0.8,
      functionalityTested: f.tested,
      comps: prices.map((p, i) => ({ id: `what-if-${i}`, evidenceType: "sold_user_recorded", totalPriceCents: p, saleDate: new Date(now.getTime() - (10 + i * 7) * 86_400_000).toISOString(), matchConfidence: 0.9, variantMatch: true, conditionMatch: "exact" })),
      liquidity: { soldCount90d: Number(f.soldCount) || null, activeCount: f.activeCount === "" ? null : Number(f.activeCount), rareItem: false },
      route: f.shipped
        ? { source: "shipped", precision: "exact", trafficAware: false, oneWayMinutes: 0, oneWayMiles: 0, tollsCents: 0, parkingCents: 0, computedAt: null }
        : { source: "manual", precision: "exact", trafficAware: false, oneWayMinutes: Number(f.minutes) || null, oneWayMiles: Number(f.miles) || null, tollsCents: 0, parkingCents: 0, computedAt: null },
      shippingLabelCents: cents(f.label) ?? 0,
      channel: f.channel as "ebay_us" | "local_cash",
      buyingPowerCents,
    };
    return evaluateOpportunity(input, settings, now);
  }, [f, settings, buyingPowerCents]);

  const c = ev?.scenariosAtAsking?.find((s) => s.name === "conservative")?.result;
  const b = ev?.scenariosAtAsking?.find((s) => s.name === "base")?.result;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_400px]">
      <Card>
        <CardHeader title="Inputs" description="Use real sold prices from Terapeak. Low and high default to plus or minus about 10% of the median." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Asking price ($)"><Input inputMode="decimal" value={f.asking} onChange={set("asking")} /></Field>
          <Field label="Category">
            <Select value={f.category} onChange={set("category")}>{Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          </Field>
          <Field label="Median sold price ($)"><Input inputMode="decimal" value={f.median} onChange={set("median")} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Lowest sold ($)"><Input inputMode="decimal" value={f.low} onChange={set("low")} placeholder="auto" /></Field>
            <Field label="Highest sold ($)"><Input inputMode="decimal" value={f.high} onChange={set("high")} placeholder="auto" /></Field>
          </div>
          <Field label="Sold in last 90 days"><Input inputMode="numeric" value={f.soldCount} onChange={set("soldCount")} /></Field>
          <Field label="Active listings now"><Input inputMode="numeric" value={f.activeCount} onChange={set("activeCount")} /></Field>
          <Field label="Sell on">
            <Select value={f.channel} onChange={set("channel")}><option value="ebay_us">eBay (shipped)</option><option value="local_cash">Local cash</option></Select>
          </Field>
          <Field label="Shipping label ($)"><Input inputMode="decimal" value={f.label} onChange={set("label")} /></Field>
          {!f.shipped ? (
            <>
              <Field label="One-way drive (min)"><Input inputMode="numeric" value={f.minutes} onChange={set("minutes")} /></Field>
              <Field label="One-way distance (mi)"><Input inputMode="decimal" value={f.miles} onChange={set("miles")} /></Field>
            </>
          ) : null}
          <div className="flex flex-col gap-2 text-sm sm:col-span-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.shipped} onChange={set("shipped")} className="size-4 accent-[var(--accent)]" /> Seller ships it (no pickup)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.verified} onChange={set("verified")} className="size-4 accent-[var(--accent)]" /> Identity and authenticity confirmed</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.tested} onChange={set("tested")} className="size-4 accent-[var(--accent)]" /> Confirmed working</label>
          </div>
        </CardBody>
      </Card>
      <div className="flex flex-col gap-5">
        <Card className="lg:sticky lg:top-20">
          <CardHeader title="Result" action={<DecisionBadge decision={ev?.decision} />} />
          <CardBody className="flex flex-col gap-3">
            {ev ? (
              <>
                <p className="text-sm text-fg-muted">{ev.decisionReason}</p>
                <KeyValue
                  items={[
                    { k: "Conservative net profit", v: formatCents(c?.netProfitCents), strong: true, tone: (c?.netProfitCents ?? 0) >= 0 ? "positive" : "negative" },
                    { k: "Base net profit", v: formatCents(b?.netProfitCents) },
                    { k: "Conservative cash ROI", v: formatBps(c?.cashRoiBps) },
                    { k: "Required for this distance", v: formatCents(ev.travelQualification.requiredNetProfitCents) },
                    { k: "Marketplace fees", v: formatCents(c?.fees.totalFeesCents) },
                    { k: "Travel cost", v: formatCents(ev.travel.totalTravelCostCents) },
                    { k: "Risk allowance", v: formatCents(ev.riskAllowanceCents) },
                    { k: "Maximum purchase price", v: formatCents(ev.maxPurchasePriceCents), strong: true },
                    { k: "Break-even sale price", v: formatCents(ev.breakEvenSalePriceCents) },
                    { k: "Profit per hour", v: formatCents(c?.profitPerHourCents) },
                    { k: "Est. days to sell", v: ev.liquidity.daysToSellBase !== null ? `${ev.liquidity.daysToSellLow} to ${ev.liquidity.daysToSellHigh}` : "Unknown" },
                  ]}
                />
                {ev.offers ? <Notice tone="accent">Open at {formatCents(ev.offers.openingOfferCents)}, target {formatCents(ev.offers.targetPriceCents)}, never above {formatCents(ev.offers.maxPriceCents)}.</Notice> : null}
              </>
            ) : (
              <p className="text-sm text-fg-muted">Enter an asking price and a median sold price.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
