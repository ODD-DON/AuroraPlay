import {
  Calculator, Car, CircleCheck, CircleX, ClipboardCheck, ExternalLink, Fingerprint, Gauge, ImagePlus, LineChart, MessageSquareText,
  ShieldAlert, Sparkles, TrendingDown, TrendingUp, Wand2,
} from "lucide-react";
import {
  addCandidateAction, addCompAction, addEvidenceAction, addRiskAction, decisionAction, deleteCompAction, identifyAction, liquidityAction,
  markPurchasedAction, resolveRiskAction, reviewCandidateAction, routeAction, startNegotiationAction, toggleCompAction, updateFactsAction,
  uploadPhotosAction,
} from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton, PriceCalculator } from "@/components/client-widgets";
import { ConfidenceMeter, Money, Pct, SeverityBadge } from "@/components/domain";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, KeyValue, LinkButton, MoneyInput, Notice, Select, Table, Td, Textarea, Th } from "@/components/ui";
import type { Evaluation } from "@/domain/evaluate";
import type { ScenarioResult } from "@/domain/profit";
import { checklistFor, SAFETY_TIPS } from "@/domain/inspection";
import { LIQUIDITY_LABELS } from "@/domain/liquidity";
import { formatBps, formatCents } from "@/domain/money";
import { draftOpeningMessage } from "@/domain/negotiation";
import { RISK_CATALOG } from "@/domain/risk";
import { CATEGORY_LABELS } from "@/domain/settings";
import { EVIDENCE_LABELS, EVIDENCE_TYPES, SOLD_EVIDENCE } from "@/domain/valuation";
import type { OpportunityDetail } from "@/server/services/opportunities";

type D = OpportunityDetail;

/* --------------------------------- financial -------------------------------- */

export function FinancialPanel({ d }: { d: D }) {
  const ev = d.evaluation;
  const sc = ev?.scenariosAtAsking;
  if (!ev || !sc) {
    return (
      <Card>
        <CardHeader icon={<Calculator />} title="Profit analysis" />
        <EmptyState
          icon={<Calculator />}
          title="Profit cannot be calculated yet"
          description="Add at least one qualifying sold comparable in Market Research below. Active asking prices are never used as resale value."
        />
      </Card>
    );
  }
  const c = sc.find((s) => s.name === "conservative")!.result;
  const rows: { label: string; key: (r: ScenarioResult["result"]) => number | null; neg?: boolean; strong?: boolean }[] = [
    { label: "Expected sale price", key: (r) => r.buyerSubtotalCents },
    { label: "Marketplace fees", key: (r) => -r.fees.totalFeesCents, neg: true },
    { label: "Shipping, packing, supplies", key: (r) => -r.sellingCostsCents, neg: true },
    { label: "Returns and damage allowance", key: (r) => -(r.returnsAllowanceCents + r.damageAllowanceCents), neg: true },
    { label: "Purchase and prep costs", key: (r) => -(r.acquisitionCashCents + r.preparationCostsCents), neg: true },
    { label: "Pickup travel", key: (r) => -r.travelCostCents, neg: true },
    { label: "Risk allowance", key: (r) => -r.riskAllowanceCents, neg: true },
    { label: "Net profit", key: (r) => r.netProfitCents, strong: true },
  ];
  return (
    <Card>
      <CardHeader icon={<Calculator />} title="Profit analysis at asking price" description="Deterministic calculation. All three scenarios use sold-comparable evidence." />
      <Table>
        <thead>
          <tr>
            <Th></Th>
            {sc.map((s) => <Th key={s.name} className="text-right capitalize">{s.name}</Th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={row.strong ? "font-semibold" : ""}>
              <Td className="text-fg-muted">{row.label}</Td>
              {sc.map((s) => {
                const v = row.key(s.result);
                return <Td key={s.name} className="text-right"><Money cents={v} colored={row.strong} className={row.neg ? "text-fg-muted" : ""} /></Td>;
              })}
            </tr>
          ))}
          <tr>
            <Td className="text-fg-muted">Cash ROI</Td>
            {sc.map((s) => <Td key={s.name} className="text-right"><Pct bps={s.result.cashRoiBps} colored /></Td>)}
          </tr>
          <tr>
            <Td className="text-fg-muted">Profit per hour</Td>
            {sc.map((s) => <Td key={s.name} className="text-right"><Money cents={s.result.profitPerHourCents} /></Td>)}
          </tr>
          <tr>
            <Td className="text-fg-muted">Expected days to sell</Td>
            {sc.map((s) => <Td key={s.name} className="text-right tabular">{s.result.holdingDays ?? "Unknown"}</Td>)}
          </tr>
        </tbody>
      </Table>
      <CardBody className="grid gap-4 border-t border-border sm:grid-cols-2">
        <KeyValue
          items={[
            { k: "Cash invested", v: formatCents(c.cashInvestedCents) },
            { k: "Break-even sale price", v: formatCents(ev.breakEvenSalePriceCents) },
            { k: "Break-even purchase price", v: formatCents(ev.breakEvenPurchasePriceCents) },
            { k: "Maximum purchase price", v: formatCents(ev.maxPurchasePriceCents), strong: true },
            { k: "Stress case (lowest comp)", v: formatCents(ev.stressNetProfitCents), tone: (ev.stressNetProfitCents ?? 0) < 0 ? "negative" : undefined },
          ]}
        />
        <KeyValue
          items={[
            { k: "Final value fee", v: formatCents(c.fees.finalValueFeeCents) },
            { k: "Per-order fee", v: formatCents(c.fees.perOrderFeeCents) },
            { k: "Fee basis (incl. est. sales tax)", v: formatCents(c.fees.feeBasisCents) },
            { k: "Gross margin", v: formatBps(c.grossMarginBps) },
            { k: "Net margin", v: formatBps(c.netMarginBps) },
          ]}
        />
        {!c.fees.scheduleVerified ? (
          <p className="text-xs text-caution sm:col-span-2">Fee schedule not yet verified against eBay&apos;s official page. Confirm it in Settings.</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* ---------------------------------- market ---------------------------------- */

export function MarketPanel({ d }: { d: D }) {
  const ev = d.evaluation;
  const v = ev?.valuation;
  const l = ev?.liquidity;
  const id = d.opportunity.id;
  const excludedReason = new Map((v?.excluded ?? []).map((e) => [e.id, e.reason]));
  const used = new Set(v?.usedCompIds ?? []);
  return (
    <Card>
      <CardHeader icon={<LineChart />} title="Market research" description="Only sold transactions set resale value. Everything else is context." />
      <CardBody className="grid gap-4 sm:grid-cols-4">
        <Metric label="Conservative value" value={<Money cents={v?.conservativeCents} />} />
        <Metric label="Median sold" value={<Money cents={v?.medianCents} />} />
        <Metric label="Range" value={v?.lowCents != null ? `${formatCents(v.lowCents)} to ${formatCents(v.highCents)}` : "Unknown"} />
        <Metric
          label="Trend (per 30 days)"
          value={
            v?.trendBpsPer30d == null ? (
              "Unknown"
            ) : (
              <span className={v.trendBpsPer30d < 0 ? "text-negative" : "text-positive"}>
                {v.trendBpsPer30d < 0 ? <TrendingDown className="mr-1 inline size-4" /> : <TrendingUp className="mr-1 inline size-4" />}
                {formatBps(v.trendBpsPer30d)}
              </span>
            )
          }
        />
        <Metric label="Qualifying sold comps" value={`${v?.sampleSize ?? 0} (${v?.evidenceStrength ?? "none"})`} />
        <Metric label="Sold-to-active (90d)" value={<Pct bps={l?.soldToActiveRatioBps} />} sub={l?.demandLabel} />
        <Metric label="Liquidity" value={l ? LIQUIDITY_LABELS[l.classification] : "Unknown"} />
        <Metric label="Est. time to sell" value={l?.daysToSellBase != null ? `${l.daysToSellLow} to ${l.daysToSellHigh} days` : "Unknown"} />
      </CardBody>
      {v?.status !== "valued" ? (
        <div className="px-4 pb-4 sm:px-5">
          <Notice tone="caution" title="No verified sold data yet">
            Record sold comparables (for example from eBay Terapeak or completed sales you can link). Active listings and AI estimates are shown for context only and never become resale value.
          </Notice>
        </div>
      ) : null}
      {v?.notes.length ? <p className="px-4 pb-3 text-xs text-fg-muted sm:px-5">{v.notes.join(" ")}</p> : null}

      <Table>
        <thead>
          <tr>
            <Th>Comparable</Th>
            <Th>Evidence</Th>
            <Th>Date</Th>
            <Th className="text-right">Total</Th>
            <Th>Status</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {d.comps.length === 0 ? (
            <tr><Td colSpan={6} className="py-6 text-center text-xs text-fg-muted">No comparables recorded.</Td></tr>
          ) : (
            d.comps.map((c) => (
              <tr key={c.id} className={c.excluded ? "opacity-50" : ""}>
                <Td className="max-w-[260px]">
                  <div className="truncate font-medium">{c.product_identity}</div>
                  <div className="flex items-center gap-1 text-xs text-fg-muted">
                    {c.source}
                    {c.condition ? ` · ${c.condition}` : ""}
                    {c.source_url ? (
                      <a href={c.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-accent" aria-label="Open source">
                        <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                  </div>
                </Td>
                <Td><Badge tone={SOLD_EVIDENCE.has(c.evidence_type) ? "positive" : "neutral"}>{EVIDENCE_LABELS[c.evidence_type]}</Badge></Td>
                <Td className="whitespace-nowrap text-xs tabular">{c.sale_date ? new Date(c.sale_date).toLocaleDateString("en-US", { timeZone: "UTC" }) : "No date"}</Td>
                <Td className="text-right"><Money cents={c.total_price_cents} /></Td>
                <Td className="text-xs">
                  {used.has(c.id) ? <span className="text-positive">Used</span> : excludedReason.get(c.id) ? <span className="text-fg-muted">{excludedReason.get(c.id)}</span> : <span className="text-fg-subtle">Context only</span>}
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1">
                    <form action={toggleCompAction}>
                      <input type="hidden" name="opportunityId" value={id} />
                      <input type="hidden" name="compId" value={c.id} />
                      <input type="hidden" name="excluded" value={c.excluded ? "false" : "true"} />
                      <Button size="sm" variant="ghost" type="submit">{c.excluded ? "Include" : "Exclude"}</Button>
                    </form>
                    <form action={deleteCompAction}>
                      <input type="hidden" name="opportunityId" value={id} />
                      <input type="hidden" name="compId" value={c.id} />
                      <Button size="sm" variant="ghost" type="submit" aria-label="Delete comparable"><CircleX /></Button>
                    </form>
                  </div>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>

      <div className="grid gap-4 border-t border-border p-4 sm:p-5 lg:grid-cols-[1fr_280px]">
        <details className="group" open={d.comps.length === 0}>
          <summary className="cursor-pointer text-sm font-medium">Add comparable sale</summary>
          <ActionForm action={addCompAction} resetOnSuccess className="mt-3">
            <input type="hidden" name="opportunityId" value={id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="What sold (exact model, variant, condition)" className="sm:col-span-2"><Input name="productIdentity" required defaultValue={d.opportunity.title} /></Field>
              <Field label="Evidence type">
                <Select name="evidenceType" defaultValue="sold_user_recorded">
                  {EVIDENCE_TYPES.filter((t) => t !== "sold_verified").map((t) => <option key={t} value={t}>{EVIDENCE_LABELS[t]}</option>)}
                </Select>
              </Field>
              <Field label="Source"><Input name="source" required defaultValue="eBay sold (Terapeak)" /></Field>
              <Field label="Sold price"><MoneyInput name="price" required /></Field>
              <Field label="Shipping paid by buyer"><MoneyInput name="shipping" /></Field>
              <Field label="Sale date"><Input name="saleDate" type="date" /></Field>
              <Field label="Link or reference"><Input name="sourceUrl" type="url" placeholder="https://" /></Field>
              <Field label="Condition vs this item">
                <Select name="conditionMatch" defaultValue="exact">
                  <option value="exact">Same condition</option>
                  <option value="worse">Worse than this item</option>
                  <option value="better">Better than this item (excluded)</option>
                  <option value="unknown">Unknown</option>
                </Select>
              </Field>
              <Field label="Same variant?">
                <Select name="variantMatch" defaultValue="yes"><option value="yes">Yes</option><option value="no">No (excluded)</option></Select>
              </Field>
              <Field label="Match confidence (%)"><Input name="matchConfidence" type="number" min="0" max="100" defaultValue={85} /></Field>
              <Field label="Grade (if graded)"><Input name="grade" placeholder="e.g. PSA 9" /></Field>
            </div>
            <div><SubmitButton variant="primary" size="sm">Save comparable</SubmitButton></div>
          </ActionForm>
        </details>
        <div>
          <p className="text-sm font-medium">Demand (last 90 days)</p>
          <p className="mb-2 text-xs text-fg-muted">
            {d.liquidity ? `Recorded ${new Date(d.liquidity.observed_at).toLocaleDateString("en-US")}: ${d.liquidity.sold_count_90d} sold, ${d.liquidity.active_count} active (${d.liquidity.source}).` : "Not recorded."}
          </p>
          <ActionForm action={liquidityAction}>
            <input type="hidden" name="opportunityId" value={id} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Sold (90d)"><Input name="soldCount90d" type="number" min="0" required defaultValue={d.liquidity?.sold_count_90d ?? undefined} /></Field>
              <Field label="Active now"><Input name="activeCount" type="number" min="0" required defaultValue={d.liquidity?.active_count ?? undefined} /></Field>
            </div>
            <Field label="Source"><Input name="source" defaultValue={d.liquidity?.source ?? "eBay Terapeak"} /></Field>
            <SubmitButton size="sm">Save demand</SubmitButton>
          </ActionForm>
        </div>
      </div>
    </Card>
  );
}

function Metric({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="mt-0.5 truncate font-semibold tabular">{value}</div>
      {sub ? <div className="text-[11px] text-fg-subtle">{sub}</div> : null}
    </div>
  );
}

/* ------------------------------- AI analysis -------------------------------- */

export function AnalysisPanel({ d }: { d: D }) {
  const ev = d.evaluation;
  if (!ev) return null;
  const x = ev.explanation;
  return (
    <Card>
      <CardHeader icon={<Sparkles />} title="Analysis" description="Generated from the evidence above by deterministic rules." />
      <CardBody className="grid gap-5 sm:grid-cols-2">
        <Section title="Why this could be profitable">{x.whyUndervalued}</Section>
        <Section title="Why someone would buy it">{x.demand} {x.timeToSale !== "Unknown." ? `Expected time to sell: ${x.timeToSale}` : ""}</Section>
        <Section title="Identity evidence">{x.identityEvidence}</Section>
        <Section title="Comparable sales">{x.comparableSales}</Section>
        <div className="sm:col-span-2">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">What could go wrong</h3>
          {x.risks.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">{x.risks.map((r) => <li key={r}>{r}</li>)}</ul>
          ) : (
            <p className="text-sm text-fg-muted">No unresolved risk factors recorded.</p>
          )}
        </div>
        <div className="sm:col-span-2">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">What would invalidate this recommendation</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">{x.invalidators.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      </CardBody>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3>
      <p className="text-sm leading-relaxed text-fg-muted">{children}</p>
    </div>
  );
}

export function HardFilters({ ev }: { ev: Evaluation }) {
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {ev.hardFilters.map((f) => (
        <li key={f.id} className="flex items-start gap-2 text-sm">
          {f.passed ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-positive" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-negative" />}
          <span>
            <span className={f.passed ? "" : "font-medium"}>{f.label}</span>
            <span className="block text-xs text-fg-muted">{f.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------- identity --------------------------------- */

export function IdentityPanel({ d, aiAvailable }: { d: D; aiAvailable: boolean }) {
  const id = d.opportunity.id;
  return (
    <Card>
      <CardHeader
        icon={<Fingerprint />}
        title="Identification"
        description="Hypotheses stay unverified until you confirm them."
        action={
          aiAvailable ? (
            <ActionForm action={identifyAction}>
              <input type="hidden" name="opportunityId" value={id} />
              <SubmitButton size="sm" pendingLabel="Analyzing photos"><Wand2 /> Run AI identification</SubmitButton>
            </ActionForm>
          ) : (
            <Badge>AI not configured</Badge>
          )
        }
      />
      <CardBody className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <ConfidenceMeter label="Identification" value={d.opportunity.identity_confidence} />
          <ConfidenceMeter label="Condition" value={d.opportunity.condition_confidence} />
          <ConfidenceMeter label="Pricing" value={d.evaluation?.valuation.confidence ?? null} />
        </div>
        {d.candidates.length === 0 ? (
          <p className="text-sm text-fg-muted">No identity hypotheses yet.{aiAvailable ? " Run AI identification on the photos, or add one manually." : " Add one manually below."}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {d.candidates.map((c) => (
              <li key={c.id} className="rounded-lg border border-border bg-bg-subtle p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.product_name}</span>
                      {c.status === "confirmed" ? <Badge tone="positive">Confirmed</Badge> : <Badge tone="caution">Hypothesis</Badge>}
                      <Badge>{c.source === "ai" ? "AI" : "You"}</Badge>
                    </div>
                    <p className="text-xs text-fg-muted">{[c.brand, c.model, c.variant, c.manufacturing_period].filter(Boolean).join(" · ") || "No details"}</p>
                  </div>
                  <span className="text-xs tabular text-fg-muted">ID {Math.round(c.identification_confidence * 100)}%{c.variant_confidence != null ? ` · variant ${Math.round(c.variant_confidence * 100)}%` : ""}</span>
                </div>
                {c.rationale ? <p className="mt-2 whitespace-pre-line text-xs text-fg-muted">{c.rationale}</p> : null}
                {c.authenticity_concerns ? <p className="mt-1 text-xs text-caution">Authenticity: {c.authenticity_concerns}</p> : null}
                {c.potential_value_high_cents ? (
                  <p className="mt-1 text-xs text-fg-subtle">AI speculative range {formatCents(c.potential_value_low_cents)} to {formatCents(c.potential_value_high_cents)} (not used for valuation)</p>
                ) : null}
                {c.required_photos.length ? <p className="mt-1 text-xs text-fg-muted">Ask the seller for: {c.required_photos.join("; ")}</p> : null}
                {c.status !== "confirmed" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <form action={reviewCandidateAction}>
                      <input type="hidden" name="opportunityId" value={id} />
                      <input type="hidden" name="candidateId" value={c.id} />
                      <input type="hidden" name="decision" value="confirmed" />
                      <Button size="sm" variant="positive" type="submit"><CircleCheck /> Confirm identity</Button>
                    </form>
                    <form action={reviewCandidateAction}>
                      <input type="hidden" name="opportunityId" value={id} />
                      <input type="hidden" name="candidateId" value={c.id} />
                      <input type="hidden" name="decision" value="rejected" />
                      <Button size="sm" variant="ghost" type="submit">Reject</Button>
                    </form>
                  </div>
                ) : null}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-fg-muted">Add evidence (marking, serial, expert opinion)</summary>
                  <ActionForm action={addEvidenceAction} resetOnSuccess className="mt-2">
                    <input type="hidden" name="opportunityId" value={id} />
                    <input type="hidden" name="candidateId" value={c.id} />
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Select name="kind" defaultValue="marking" aria-label="Evidence kind">
                        <option value="marking">Marking or hallmark</option>
                        <option value="serial">Serial number</option>
                        <option value="expert_opinion">Expert opinion</option>
                        <option value="document">Authenticity document</option>
                        <option value="reference">Reference source</option>
                        <option value="conflict">Conflicting evidence</option>
                      </Select>
                      <Input name="description" placeholder="What you observed" required className="sm:col-span-2" />
                      <Input name="url" type="url" placeholder="Link (optional)" className="sm:col-span-2" />
                      <Select name="supports" defaultValue="yes" aria-label="Supports"><option value="yes">Supports</option><option value="no">Contradicts</option></Select>
                    </div>
                    <SubmitButton size="sm">Save evidence</SubmitButton>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
        )}
        <details>
          <summary className="cursor-pointer text-sm font-medium">Add a hypothesis manually</summary>
          <ActionForm action={addCandidateAction} resetOnSuccess className="mt-3">
            <input type="hidden" name="opportunityId" value={id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Product" className="sm:col-span-2"><Input name="productName" required /></Field>
              <Field label="Brand"><Input name="brand" /></Field>
              <Field label="Model"><Input name="model" /></Field>
              <Field label="Variant"><Input name="variant" /></Field>
              <Field label="Era"><Input name="period" /></Field>
              <Field label="Confidence (%)"><Input name="confidence" type="number" min="0" max="100" defaultValue={70} /></Field>
            </div>
            <SubmitButton size="sm">Add hypothesis</SubmitButton>
          </ActionForm>
        </details>
      </CardBody>
    </Card>
  );
}

/* ---------------------------------- photos ---------------------------------- */

export function PhotoStrip({ d }: { d: D }) {
  return (
    <div className="flex flex-col gap-2">
      {d.images.length ? (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {d.images.map((img) =>
            img.storage_path ? (
              <a key={img.id} href={`/api/files/${img.storage_path}`} target="_blank" rel="noopener noreferrer" className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${img.storage_path}`} alt="Listing photo" className="h-32 w-32 rounded-lg border border-border object-cover sm:h-40 sm:w-40" loading="lazy" />
              </a>
            ) : null,
          )}
        </div>
      ) : null}
      <ActionForm action={uploadPhotosAction} resetOnSuccess className="gap-2">
        <input type="hidden" name="opportunityId" value={d.opportunity.id} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input type="file" name="photos" accept="image/*" multiple required className="h-auto flex-1 py-1.5 file:mr-3 file:rounded file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-xs file:text-fg" />
          <SubmitButton size="sm" pendingLabel="Uploading"><ImagePlus /> Add photos</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

/* ---------------------------------- travel ---------------------------------- */

export function TravelPanel({ d, routingAvailable }: { d: D; routingAvailable: boolean }) {
  const t = d.evaluation?.travel;
  const tq = d.evaluation?.travelQualification;
  const id = d.opportunity.id;
  return (
    <Card>
      <CardHeader icon={<Car />} title="Travel" description="Real drive time sets the required profit." />
      <CardBody className="flex flex-col gap-3">
        {t && t.status !== "unknown" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {tq?.tier ? <Badge tone={tq.outsideLocalArea ? "accent" : "neutral"}>{tq.tier.label}: needs {formatCents(tq.requiredNetProfitCents)}</Badge> : null}
              {t.status === "provisional" ? <Badge tone="caution">Provisional</Badge> : null}
              {t.status === "not_required" ? <Badge>Ships to you</Badge> : null}
              {tq?.requiresManualReview ? <Badge tone="caution">Manual review</Badge> : null}
            </div>
            {t.status !== "not_required" ? (
              <KeyValue
                items={[
                  { k: "One-way drive", v: `${t.oneWayMinutes} min` },
                  { k: "Round trip", v: `${t.roundTripMiles} mi, ${t.roundTripMinutes} min` },
                  { k: "Total sourcing time", v: `${t.totalSourcingMinutes} min (incl. ${t.pickupMinutes} min pickup)` },
                  { k: t.vehicleMethod === "mileage_rate" ? "Vehicle (mileage rate)" : "Fuel and vehicle (actual)", v: formatCents(t.vehicleCostCents) },
                  { k: "Tolls and parking", v: formatCents(t.tollsCents + t.parkingCents) },
                  { k: "Wasted-trip allowance", v: formatCents(t.wastedTripAllowanceCents) },
                  { k: "Travel cost", v: formatCents(t.totalTravelCostCents), strong: true },
                  { k: "Your time (not in profit)", v: formatCents(t.ownerTimeValueCents) },
                ]}
              />
            ) : null}
            {t.notes.length ? <p className="text-xs text-fg-muted">{t.notes.join(" ")}</p> : null}
          </>
        ) : (
          <Notice tone="caution">Drive time unknown. The profit threshold depends on it, so the deal stays in research until it is added.</Notice>
        )}
        <details open={!t || t.status === "unknown"}>
          <summary className="cursor-pointer text-sm font-medium">Update travel</summary>
          <div className="mt-3 flex flex-col gap-4">
            {routingAvailable ? (
              <ActionForm action={routeAction}>
                <input type="hidden" name="opportunityId" value={id} />
                <input type="hidden" name="mode" value="google" />
                <Field label="Pickup address or area"><Input name="destination" required defaultValue={d.route?.destination_text ?? d.listing?.location_text ?? ""} /></Field>
                <Select name="precision" defaultValue="approximate" aria-label="Precision"><option value="approximate">Approximate area</option><option value="exact">Exact address</option></Select>
                <SubmitButton size="sm" pendingLabel="Routing">Compute with Google Routes</SubmitButton>
              </ActionForm>
            ) : null}
            <ActionForm action={routeAction}>
              <input type="hidden" name="opportunityId" value={id} />
              <input type="hidden" name="mode" value="manual" />
              <div className="grid grid-cols-2 gap-2">
                <Field label="One-way minutes"><Input name="oneWayMinutes" type="number" min="0" required defaultValue={d.route?.oneWayMinutes ?? undefined} /></Field>
                <Field label="One-way miles"><Input name="oneWayMiles" type="number" min="0" step="0.1" required defaultValue={d.route?.oneWayMiles ?? undefined} /></Field>
                <Field label="Tolls (round trip)"><MoneyInput name="tolls" defaultValue={d.route?.tollsCents || undefined} /></Field>
                <Field label="Parking"><MoneyInput name="parking" defaultValue={d.route?.parkingCents || undefined} /></Field>
              </div>
              <Select name="precision" defaultValue={d.route?.precision === "exact" ? "exact" : "approximate"} aria-label="Precision">
                <option value="approximate">Approximate location (provisional)</option>
                <option value="exact">Exact pickup location</option>
              </Select>
              <input type="hidden" name="destination" value={d.listing?.location_text ?? ""} />
              <SubmitButton size="sm">Save manual drive time</SubmitButton>
            </ActionForm>
            <ActionForm action={routeAction}>
              <input type="hidden" name="opportunityId" value={id} />
              <input type="hidden" name="mode" value="shipped" />
              <SubmitButton size="sm" variant="ghost">Seller ships it (no pickup)</SubmitButton>
            </ActionForm>
          </div>
        </details>
      </CardBody>
    </Card>
  );
}

/* ----------------------------------- facts ---------------------------------- */

export function FactsPanel({ d }: { d: D }) {
  const o = d.opportunity;
  return (
    <Card>
      <CardHeader icon={<Gauge />} title="Item facts" description="Your verified facts drive the evaluation." />
      <CardBody>
        <ActionForm action={updateFactsAction}>
          <input type="hidden" name="opportunityId" value={o.id} />
          <input type="hidden" name="functionalityTestedPresent" value="1" />
          <input type="hidden" name="rareItemPresent" value="1" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Asking price"><MoneyInput name="askingPrice" defaultValue={o.asking_price_cents} /></Field>
            <Field label="Category">
              <Select name="category" defaultValue={o.category ?? ""}>
                <option value="">Unknown</option>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Identity">
              <Select name="identityStatus" defaultValue={o.identity_status}>
                <option value="unverified">Unverified</option>
                <option value="probable">Probable</option>
                <option value="verified">Verified by me</option>
              </Select>
            </Field>
            <Field label="Authenticity">
              <Select name="authenticityStatus" defaultValue={o.authenticity_status}>
                <option value="unverified">Not verified</option>
                <option value="not_required">Not a concern for this item</option>
                <option value="verified">Verified (evidence recorded)</option>
                <option value="failed">Failed / reproduction</option>
              </Select>
            </Field>
            <Field label="Condition confidence (%)"><Input name="conditionConfidence" type="number" min="0" max="100" defaultValue={Math.round(o.condition_confidence * 100)} /></Field>
            <Field label="Sell on">
              <Select name="channel" defaultValue={o.channel}><option value="ebay_us">eBay (shipped)</option><option value="local_cash">Local cash sale</option></Select>
            </Field>
            <Field label="Outbound shipping label (est.)"><MoneyInput name="shippingLabel" defaultValue={o.shipping_label_cents} /></Field>
            <Field label="Repairs or parts (est.)"><MoneyInput name="repairEstimate" defaultValue={o.repair_estimate_cents} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="functionalityTested" defaultChecked={o.functionality_tested} className="size-4 accent-[var(--accent)]" /> Confirmed working</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="rareItem" defaultChecked={o.rare_item} className="size-4 accent-[var(--accent)]" /> Rare or one-of-one</label>
            <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" rows={2} defaultValue={o.notes ?? ""} /></Field>
          </div>
          <div><SubmitButton size="sm" variant="primary">Save facts</SubmitButton></div>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

/* ----------------------------------- risks ---------------------------------- */

export function RiskPanel({ d }: { d: D }) {
  const ev = d.evaluation;
  const id = d.opportunity.id;
  const factors = ev?.riskFactors ?? [];
  return (
    <Card>
      <CardHeader icon={<ShieldAlert />} title="Risk factors" description={ev ? `Risk allowance in profit: ${formatCents(ev.riskAllowanceCents)}` : undefined} />
      <CardBody className="flex flex-col gap-2">
        {factors.length === 0 ? <p className="text-sm text-fg-muted">No risk factors detected.</p> : null}
        {factors.map((f) => (
          <div key={f.code} className="flex items-start justify-between gap-2 rounded-md border border-border p-2.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={f.severity} />
                <span className={`text-sm font-medium ${f.resolved ? "line-through opacity-60" : ""}`}>{f.title}</span>
              </div>
              <p className="mt-0.5 text-xs text-fg-muted">{f.detail}</p>
            </div>
            <form action={resolveRiskAction}>
              <input type="hidden" name="opportunityId" value={id} />
              <input type="hidden" name="code" value={f.code} />
              <input type="hidden" name="resolved" value={f.resolved ? "false" : "true"} />
              <Button size="sm" variant="ghost" type="submit">{f.resolved ? "Reopen" : "Mark resolved"}</Button>
            </form>
          </div>
        ))}
        <ActionForm action={addRiskAction} className="mt-1 gap-2">
          <input type="hidden" name="opportunityId" value={id} />
          <div className="flex gap-2">
            <Select name="code" aria-label="Risk factor" className="flex-1">
              {Object.values(RISK_CATALOG).map((r) => <option key={r.code} value={r.code}>{r.title}</option>)}
            </Select>
            <SubmitButton size="sm">Flag</SubmitButton>
          </div>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

/* ---------------------------------- actions --------------------------------- */

export function ActionPanel({ d }: { d: D }) {
  const o = d.opportunity;
  const ev = d.evaluation;
  const offers = ev?.offers;
  const message = offers
    ? draftOpeningMessage({ seed: o.id, itemShortName: o.title.split(/[,(|-]/)[0]!.trim().split(/\s+/).slice(0, 4).join(" "), offerCents: offers.openingOfferCents, canPickUpToday: (ev?.travel.oneWayMinutes ?? 99) <= 30 })
    : null;
  const closed = ["purchased", "listed", "sold", "passed", "sold_by_other", "expired"].includes(o.status);
  return (
    <Card className="border-accent/30">
      <CardHeader icon={<MessageSquareText />} title="Offer plan" />
      <CardBody className="flex flex-col gap-4">
        {offers ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <OfferBox label="Open at" cents={offers.openingOfferCents} />
              <OfferBox label="Target" cents={offers.targetPriceCents} />
              <OfferBox label="Never above" cents={offers.maxPriceCents} strong />
            </div>
            <p className="text-xs text-fg-muted">{offers.rationale}</p>
            {message ? (
              <div className="rounded-lg border border-border bg-bg-subtle p-3">
                <p className="text-sm">{message}</p>
                <div className="mt-2 flex justify-end"><CopyButton text={message} label="Copy suggested message" /></div>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-fg-muted">No safe maximum price yet. It appears once sold comparables, demand, and drive time are recorded.</p>
        )}
        {ev?.scenariosAtAsking ? <PriceCalculator evaluation={ev} askingCents={o.asking_price_cents} maxCents={ev.maxPurchasePriceCents} /> : null}
        {!closed ? (
          <div className="flex flex-col gap-2">
            {offers ? (
              <ActionForm action={startNegotiationAction}>
                <input type="hidden" name="opportunityId" value={o.id} />
                <SubmitButton variant="primary" className="w-full">{o.status === "negotiating" ? "Open negotiation" : "Start negotiation"}</SubmitButton>
              </ActionForm>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <form action={decisionAction}>
                <input type="hidden" name="opportunityId" value={o.id} />
                <input type="hidden" name="decision" value="save" />
                <Button type="submit" className="w-full">Save</Button>
              </form>
              <form action={decisionAction}>
                <input type="hidden" name="opportunityId" value={o.id} />
                <input type="hidden" name="decision" value="pass" />
                <Button type="submit" variant="ghost" className="w-full">Pass</Button>
              </form>
            </div>
            <LinkButton href="/pickups" variant="ghost" size="sm">Plan pickup</LinkButton>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function OfferBox({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className={`rounded-lg border p-2 ${strong ? "border-accent/40 bg-accent-soft" : "border-border bg-bg-subtle"}`}>
      <div className="text-[11px] text-fg-muted">{label}</div>
      <div className={`font-semibold tabular ${strong ? "text-accent" : ""}`}>{formatCents(cents)}</div>
    </div>
  );
}

export function PurchasePanel({ d }: { d: D }) {
  const o = d.opportunity;
  if (["purchased", "listed", "sold"].includes(o.status)) return null;
  const checklist = checklistFor(o.category);
  const travel = d.evaluation?.travel.totalTravelCostCents ?? 0;
  return (
    <Card id="purchase" className="scroll-mt-20">
      <CardHeader icon={<ClipboardCheck />} title="Inspect and record purchase" description="Recording a purchase moves cash into inventory. Nothing is paid through this app." />
      <CardBody>
        <ActionForm action={markPurchasedAction}>
          <input type="hidden" name="opportunityId" value={o.id} />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-medium text-fg-muted">Inspection checklist</legend>
            {checklist.map((c) => (
              <label key={c.id} className="flex items-start gap-2 text-sm">
                <input type="hidden" name="checklistKeys" value={c.id} />
                <input type="checkbox" name={`check_${c.id}`} className="mt-0.5 size-4 accent-[var(--accent)]" />
                <span>{c.label}{c.critical ? <span className="ml-1 text-xs text-negative">critical</span> : null}</span>
              </label>
            ))}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Price paid"><MoneyInput name="pricePaid" required defaultValue={o.max_purchase_cents !== null ? Math.min(o.asking_price_cents, o.max_purchase_cents) : o.asking_price_cents} /></Field>
            <Field label="Purchase date"><Input name="purchaseDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></Field>
            <Field label="Travel cost to record" hint="Defaults to the estimate."><MoneyInput name="travelCost" defaultValue={travel || undefined} /></Field>
            <Field label="Sales tax paid (if any)"><MoneyInput name="purchaseTax" /></Field>
            <Field label="Serial number"><Input name="serialNumber" /></Field>
            <Field label="Payment method">
              <Select name="paymentMethod" defaultValue="cash"><option value="cash">Cash</option><option value="app">Payment app (after inspection)</option><option value="card">Card</option></Select>
            </Field>
            <Field label="Condition notes" className="sm:col-span-2"><Input name="condition" /></Field>
            <Field label="Accessories included" className="sm:col-span-2"><Input name="accessories" /></Field>
            <Field label="Storage location"><Input name="storageLocation" placeholder="e.g. Shelf B2" /></Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <input type="checkbox" name="allowOverMax" className="size-4 accent-[var(--accent)]" /> I paid more than the calculated maximum and want to record it anyway
          </label>
          <SubmitButton variant="positive" pendingLabel="Recording">Mark purchased</SubmitButton>
        </ActionForm>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-fg-muted">{SAFETY_TIPS.map((t) => <li key={t}>{t}</li>)}</ul>
      </CardBody>
    </Card>
  );
}
