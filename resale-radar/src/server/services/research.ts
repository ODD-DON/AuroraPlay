import "server-only";
import { z } from "zod";
import { makeRisk, RISK_CATALOG } from "@/domain/risk";
import { EVIDENCE_TYPES } from "@/domain/valuation";
import type { Queryable } from "@/server/db";
import { audit, createAlert } from "./core";
import { reevaluate, setStatus } from "./opportunities";

export const compInputSchema = z.object({
  productIdentity: z.string().trim().min(2).max(300),
  source: z.string().trim().min(2).max(80),
  sourceUrl: z.string().trim().url().max(2000).nullable().optional(),
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priceCents: z.number().int().min(0).max(100_000_000),
  shippingCents: z.number().int().min(0).max(1_000_000).nullable().optional(),
  condition: z.string().max(120).nullable().optional(),
  variant: z.string().max(200).nullable().optional(),
  grade: z.string().max(60).nullable().optional(),
  evidenceType: z.enum(EVIDENCE_TYPES),
  matchConfidence: z.number().min(0).max(1),
  variantMatch: z.boolean(),
  conditionMatch: z.enum(["exact", "better", "worse", "unknown"]),
  notes: z.string().max(2000).nullable().optional(),
});
export type CompInput = z.infer<typeof compInputSchema>;

export async function addComparable(q: Queryable, ownerId: string, opportunityId: string, raw: CompInput) {
  const c = compInputSchema.parse(raw);
  if ((c.evidenceType === "sold_verified" || c.evidenceType === "sold_user_recorded") && !c.saleDate) {
    throw new Error("Sold comparables need a sale date.");
  }
  const total = c.priceCents + (c.shippingCents ?? 0);
  await q.query(
    `insert into comparable_sales (owner_id, opportunity_id, product_identity, source, source_url, sale_date, price_cents, shipping_cents,
       total_price_cents, condition, variant, grade, evidence_type, match_confidence, variant_match, condition_match, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [ownerId, opportunityId, c.productIdentity, c.source, c.sourceUrl ?? null, c.saleDate ?? null, c.priceCents, c.shippingCents ?? null, total,
      c.condition ?? null, c.variant ?? null, c.grade ?? null, c.evidenceType, c.matchConfidence, c.variantMatch, c.conditionMatch, c.notes ?? null],
  );
  await audit(q, ownerId, "comparable.added", "opportunity", opportunityId, { evidenceType: c.evidenceType, totalCents: total });
  await setStatus(q, ownerId, opportunityId, "researching", null).catch(() => undefined);
  return reevaluate(q, ownerId, opportunityId);
}

export async function setComparableExcluded(q: Queryable, ownerId: string, compId: string, excluded: boolean) {
  const [row] = await q.query<{ opportunity_id: string }>(`update comparable_sales set excluded = $3 where id = $1 and owner_id = $2 returning opportunity_id`, [compId, ownerId, excluded]);
  if (row) await reevaluate(q, ownerId, row.opportunity_id);
}

export async function deleteComparable(q: Queryable, ownerId: string, compId: string) {
  const [row] = await q.query<{ opportunity_id: string }>(`delete from comparable_sales where id = $1 and owner_id = $2 returning opportunity_id`, [compId, ownerId]);
  if (row) await reevaluate(q, ownerId, row.opportunity_id);
}

export const liquiditySchema = z.object({
  soldCount90d: z.number().int().min(0).max(1_000_000),
  activeCount: z.number().int().min(0).max(1_000_000),
  source: z.string().trim().min(2).max(80),
  sourceUrl: z.string().url().max(2000).nullable().optional(),
});

export async function recordLiquidity(q: Queryable, ownerId: string, opportunityId: string, raw: z.infer<typeof liquiditySchema>) {
  const l = liquiditySchema.parse(raw);
  await q.query(`insert into liquidity_estimates (owner_id, opportunity_id, sold_count_90d, active_count, source, source_url) values ($1,$2,$3,$4,$5,$6)`, [
    ownerId, opportunityId, l.soldCount90d, l.activeCount, l.source, l.sourceUrl ?? null,
  ]);
  return reevaluate(q, ownerId, opportunityId);
}

export const routeSchema = z.object({
  source: z.enum(["google_routes", "manual", "shipped"]),
  precision: z.enum(["exact", "approximate", "unknown"]),
  trafficAware: z.boolean().default(false),
  oneWayMinutes: z.number().int().min(0).max(600).nullable(),
  oneWayMiles: z.number().min(0).max(600).nullable(),
  tollsCents: z.number().int().min(0).max(100_000).default(0),
  parkingCents: z.number().int().min(0).max(100_000).default(0),
  destinationText: z.string().max(300).nullable().optional(),
  raw: z.unknown().optional(),
});

export async function recordRoute(q: Queryable, ownerId: string, opportunityId: string, raw: z.input<typeof routeSchema>) {
  const r = routeSchema.parse(raw);
  if (r.source !== "shipped" && (r.oneWayMinutes === null || r.oneWayMiles === null)) throw new Error("Drive time and distance are both required.");
  await q.query(
    `insert into route_estimates (owner_id, opportunity_id, source, precision, traffic_aware, one_way_minutes, one_way_miles, tolls_cents, parking_cents, destination_text, raw)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [ownerId, opportunityId, r.source, r.source === "shipped" ? "exact" : r.precision, r.trafficAware, r.source === "shipped" ? 0 : r.oneWayMinutes,
      r.source === "shipped" ? 0 : r.oneWayMiles, r.tollsCents, r.parkingCents, r.destinationText ?? null, r.raw ?? null],
  );
  return reevaluate(q, ownerId, opportunityId);
}

export const factsSchema = z.object({
  title: z.string().trim().min(2).max(300).optional(),
  category: z.string().max(60).nullable().optional(),
  askingPriceCents: z.number().int().min(0).max(100_000_000).optional(),
  identityStatus: z.enum(["verified", "probable", "unverified"]).optional(),
  identityConfidence: z.number().min(0).max(1).optional(),
  authenticityStatus: z.enum(["verified", "not_required", "unverified", "failed"]).optional(),
  conditionConfidence: z.number().min(0).max(1).optional(),
  functionalityTested: z.boolean().optional(),
  rareItem: z.boolean().optional(),
  channel: z.enum(["ebay_us", "local_cash"]).optional(),
  shippingLabelCents: z.number().int().min(0).max(100_000).optional(),
  packagingCents: z.number().int().min(0).max(50_000).nullable().optional(),
  inboundShippingCents: z.number().int().min(0).max(100_000).optional(),
  repairEstimateCents: z.number().int().min(0).max(1_000_000).optional(),
  pickupMinutes: z.number().int().min(0).max(240).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  listingAvailable: z.boolean().optional(),
});

const FACT_COLUMNS: Record<string, string> = {
  title: "title", category: "category", askingPriceCents: "asking_price_cents", identityStatus: "identity_status",
  identityConfidence: "identity_confidence", authenticityStatus: "authenticity_status", conditionConfidence: "condition_confidence",
  functionalityTested: "functionality_tested", rareItem: "rare_item", channel: "channel", shippingLabelCents: "shipping_label_cents",
  packagingCents: "packaging_cents", inboundShippingCents: "inbound_shipping_cents", repairEstimateCents: "repair_estimate_cents",
  pickupMinutes: "pickup_minutes", notes: "notes",
};

export async function updateFacts(q: Queryable, ownerId: string, opportunityId: string, raw: z.input<typeof factsSchema>) {
  const f = factsSchema.parse(raw);
  const sets: string[] = [];
  const params: unknown[] = [opportunityId, ownerId];
  for (const [k, col] of Object.entries(FACT_COLUMNS)) {
    const v = (f as Record<string, unknown>)[k];
    if (v === undefined) continue;
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  }
  if (sets.length) await q.query(`update opportunities set ${sets.join(", ")}, updated_at = now() where id = $1 and owner_id = $2`, params);
  if (f.askingPriceCents !== undefined) {
    const [o] = await q.query<{ listing_id: string | null }>(`select listing_id from opportunities where id = $1`, [opportunityId]);
    if (o?.listing_id) {
      await q.query(`update source_listings set asking_price_cents = $2, last_observed_at = now() where id = $1`, [o.listing_id, f.askingPriceCents]);
      await q.query(`insert into listing_price_history (owner_id, listing_id, price_cents) values ($1,$2,$3)`, [ownerId, o.listing_id, f.askingPriceCents]);
    }
  }
  if (f.listingAvailable === false) await setStatus(q, ownerId, opportunityId, "unavailable", "Marked unavailable");
  if (f.identityStatus === "verified") await setStatus(q, ownerId, opportunityId, "identified", "Identity confirmed").catch(() => undefined);
  if (f.authenticityStatus && f.authenticityStatus !== "unverified") {
    await q.query(`insert into authenticity_checks (owner_id, opportunity_id, method, result) values ($1,$2,'owner_review',$3)`, [
      ownerId, opportunityId, f.authenticityStatus === "failed" ? "failed" : f.authenticityStatus,
    ]);
  }
  await audit(q, ownerId, "opportunity.facts_updated", "opportunity", opportunityId, f as Record<string, unknown>);
  return reevaluate(q, ownerId, opportunityId);
}

export async function addRiskFactor(q: Queryable, ownerId: string, opportunityId: string, code: string, detail?: string) {
  if (!RISK_CATALOG[code]) throw new Error("Unknown risk factor");
  const r = makeRisk(code, detail);
  await q.query(
    `insert into opportunity_risk_factors (owner_id, opportunity_id, code, severity, title, detail, allowance_bps, source) values ($1,$2,$3,$4,$5,$6,$7,'user')
     on conflict (opportunity_id, code) do update set resolved = false, detail = excluded.detail`,
    [ownerId, opportunityId, r.code, r.severity, r.title, r.detail, r.allowanceBps],
  );
  if (code === "possible_stolen" || code === "suspicious_payment") await setStatus(q, ownerId, opportunityId, "suspicious", r.title);
  return reevaluate(q, ownerId, opportunityId);
}

/** Resolving an auto-derived risk stores an explicit resolved override so the engine respects it. */
export async function resolveRiskFactor(q: Queryable, ownerId: string, opportunityId: string, code: string, resolved: boolean) {
  const r = makeRisk(code);
  await q.query(
    `insert into opportunity_risk_factors (owner_id, opportunity_id, code, severity, title, detail, allowance_bps, resolved, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'user')
     on conflict (opportunity_id, code) do update set resolved = excluded.resolved`,
    [ownerId, opportunityId, r.code, r.severity, r.title, r.detail, r.allowanceBps, resolved],
  );
  await audit(q, ownerId, resolved ? "risk.resolved" : "risk.reopened", "opportunity", opportunityId, { code });
  return reevaluate(q, ownerId, opportunityId);
}

export async function recordDecision(q: Queryable, ownerId: string, opportunityId: string, decision: "pursue" | "pass" | "save", reason: string | null) {
  const [o] = await q.query<{ decision: string | null }>(`select decision from opportunities where id = $1 and owner_id = $2`, [opportunityId, ownerId]);
  await q.query(`insert into user_decisions (owner_id, opportunity_id, decision, system_decision, reason) values ($1,$2,$3,$4,$5)`, [
    ownerId, opportunityId, decision, o?.decision ?? null, reason,
  ]);
  if (decision === "pass") await setStatus(q, ownerId, opportunityId, "passed", reason);
  await audit(q, ownerId, `opportunity.${decision}`, "opportunity", opportunityId, { reason });
}

/* ------------------------------ identification ------------------------------ */

export const candidateSchema = z.object({
  productName: z.string().trim().min(2).max(300),
  brand: z.string().max(120).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  variant: z.string().max(200).nullable().optional(),
  manufacturingPeriod: z.string().max(80).nullable().optional(),
  identificationConfidence: z.number().min(0).max(1),
  rationale: z.string().max(2000).nullable().optional(),
});

export async function addCandidate(q: Queryable, ownerId: string, opportunityId: string, raw: z.infer<typeof candidateSchema>, source: "user" | "ai" = "user", aiRunId: string | null = null) {
  const c = candidateSchema.parse(raw);
  const [row] = await q.query<{ id: string }>(
    `insert into item_identity_candidates (owner_id, opportunity_id, product_name, brand, model, variant, manufacturing_period, identification_confidence, rationale, source, ai_run_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [ownerId, opportunityId, c.productName, c.brand ?? null, c.model ?? null, c.variant ?? null, c.manufacturingPeriod ?? null, c.identificationConfidence, c.rationale ?? null, source, aiRunId],
  );
  return row!.id;
}

export async function reviewCandidate(q: Queryable, ownerId: string, candidateId: string, decision: "confirmed" | "rejected", notes: string | null) {
  const [c] = await q.query<{ opportunity_id: string; product_name: string; identification_confidence: string; ai_run_id: string | null }>(
    `update item_identity_candidates set status = $3 where id = $1 and owner_id = $2 returning opportunity_id, product_name, identification_confidence, ai_run_id`,
    [candidateId, ownerId, decision],
  );
  if (!c) throw new Error("Candidate not found");
  await q.query(`insert into identification_reviews (owner_id, candidate_id, decision, notes) values ($1,$2,$3,$4)`, [ownerId, candidateId, decision, notes]);
  await q.query(`insert into ai_feedback (owner_id, ai_run_id, candidate_id, kind) values ($1,$2,$3,$4)`, [ownerId, c.ai_run_id, candidateId, decision === "confirmed" ? "correct" : "incorrect"]);
  if (decision === "confirmed") {
    await q.query(`update item_identity_candidates set status = 'hypothesis' where opportunity_id = $1 and id <> $2 and status = 'confirmed'`, [c.opportunity_id, candidateId]);
    await q.query(`update opportunities set identity_status = 'verified', identity_confidence = greatest(identity_confidence, 0.9), title = $2, updated_at = now() where id = $1`, [c.opportunity_id, c.product_name]);
    await setStatus(q, ownerId, c.opportunity_id, "identified", `Confirmed: ${c.product_name}`).catch(() => undefined);
  }
  return reevaluate(q, ownerId, c.opportunity_id);
}

export async function addIdentityEvidence(q: Queryable, ownerId: string, candidateId: string, kind: string, description: string, supports: boolean, url: string | null) {
  await q.query(`insert into identity_evidence (owner_id, candidate_id, kind, description, supports, url) values ($1,$2,$3,$4,$5,$6)`, [ownerId, candidateId, kind, description, supports, url]);
}

export async function notifyNewComps(q: Queryable, ownerId: string, opportunityId: string, title: string, count: number) {
  await createAlert(q, ownerId, {
    kind: "new_verified_comps",
    priority: "normal",
    title: `New comparable sales: ${title}`,
    body: `${count} new comparable sale${count === 1 ? "" : "s"} recorded.`,
    link: `/deals/${opportunityId}`,
    opportunityId,
    dedupeKey: `comps:${opportunityId}:${count}:${new Date().toISOString().slice(0, 10)}`,
  });
}
