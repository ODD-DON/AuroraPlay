import "server-only";
import { assessDuplicate, canonicalizeUrl, type ListingFingerprint } from "@/domain/dedup";
import { DECISION_LABELS, evaluateOpportunity, type Decision, type Evaluation, type OpportunityInput } from "@/domain/evaluate";
import { formatBps, formatCents } from "@/domain/money";
import type { RiskFactor } from "@/domain/risk";
import type { BusinessSettings } from "@/domain/settings";
import type { RouteEstimate } from "@/domain/travel";
import type { Comparable, ConditionMatch, EvidenceType } from "@/domain/valuation";
import { num, numOrNull, type Queryable } from "@/server/db";
import { audit, createAlert, getBuyingPower, getSettings } from "./core";

export const ENGINE_VERSION = "2026.10.1";

export const OPPORTUNITY_STATUSES = [
  "discovered", "identified", "researching", "verified", "qualified", "negotiating", "purchased", "listed", "sold",
  "passed", "expired", "sold_by_other", "suspicious", "research_required", "unavailable", "duplicate",
] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const STATUS_LABELS: Record<OpportunityStatus, string> = {
  discovered: "Discovered", identified: "Identified", researching: "Researching", verified: "Verified", qualified: "Qualified",
  negotiating: "Negotiating", purchased: "Purchased", listed: "Listed", sold: "Sold", passed: "Passed", expired: "Expired",
  sold_by_other: "Sold by another buyer", suspicious: "Suspicious", research_required: "Research required",
  unavailable: "Unavailable", duplicate: "Duplicate",
};

/* --------------------------------- import --------------------------------- */

export interface ImportListingInput {
  url?: string | null;
  title: string;
  description?: string | null;
  askingPriceCents: number;
  category?: string | null;
  condition?: string | null;
  sellerName?: string | null;
  locationText?: string | null;
  locationPrecision?: "exact" | "approximate" | "unknown";
  importMethod: "url" | "screenshot" | "manual" | "share" | "api";
  source?: string;
  externalId?: string | null;
  shippingAvailable?: boolean | null;
  raw?: unknown;
}

export interface ImportResult {
  opportunityId: string;
  listingId: string;
  duplicateOf: string | null;
  possibleDuplicates: { opportunityId: string; title: string; signals: string[] }[];
}

export async function importListing(q: Queryable, ownerId: string, input: ImportListingInput): Promise<ImportResult> {
  const canon = input.url ? canonicalizeUrl(input.url) : null;
  if (input.url && !canon) throw new Error("That URL could not be read. Paste the full listing link starting with https://");
  const source = input.source ?? canon?.source ?? "manual";
  const externalId = input.externalId ?? canon?.externalId ?? null;
  const canonicalUrl = canon?.canonicalUrl ?? null;

  // Exact duplicate: same marketplace id or URL. Record a fresh observation and return the existing deal.
  const existing = await q.query<{ id: string; asking_price_cents: number; opp_id: string | null }>(
    `select l.id, l.asking_price_cents, o.id as opp_id from source_listings l left join opportunities o on o.listing_id = l.id
      where l.owner_id = $1 and ((l.source = $2 and l.external_id = $3) or l.canonical_url = $4) limit 1`,
    [ownerId, source, externalId, canonicalUrl],
  );
  if (existing[0]?.opp_id) {
    const prev = num(existing[0].asking_price_cents);
    await q.query(`update source_listings set last_observed_at = now() where id = $1`, [existing[0].id]);
    await q.query(`insert into listing_observations (owner_id, listing_id, status, price_cents) values ($1, $2, 'active', $3)`, [ownerId, existing[0].id, input.askingPriceCents]);
    if (prev !== input.askingPriceCents) {
      await q.query(`update source_listings set asking_price_cents = $2 where id = $1`, [existing[0].id, input.askingPriceCents]);
      await q.query(`insert into listing_price_history (owner_id, listing_id, price_cents) values ($1, $2, $3)`, [ownerId, existing[0].id, input.askingPriceCents]);
      await q.query(`update opportunities set asking_price_cents = $2, updated_at = now() where id = $1`, [existing[0].opp_id, input.askingPriceCents]);
      if (input.askingPriceCents < prev) {
        await createAlert(q, ownerId, {
          kind: "price_drop",
          priority: "high",
          title: `Price drop: ${input.title}`,
          body: `${formatCents(prev)} to ${formatCents(input.askingPriceCents)}`,
          link: `/deals/${existing[0].opp_id}`,
          opportunityId: existing[0].opp_id,
          dedupeKey: `price_drop:${existing[0].id}:${input.askingPriceCents}`,
        });
      }
      await reevaluate(q, ownerId, existing[0].opp_id);
    }
    return { opportunityId: existing[0].opp_id, listingId: existing[0].id, duplicateOf: existing[0].opp_id, possibleDuplicates: [] };
  }

  const fingerprint: Omit<ListingFingerprint, "id"> = {
    source,
    externalId,
    canonicalUrl,
    title: input.title,
    priceCents: input.askingPriceCents,
    sellerName: input.sellerName ?? null,
    imageHashes: [],
  };

  const [listing] = await q.query<{ id: string }>(
    `insert into source_listings (owner_id, source, external_id, canonical_url, title, description, asking_price_cents, category, condition,
       seller_name, location_text, location_precision, shipping_available, status, import_method, fingerprint, raw, source_confidence)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14,$15,$16,$17) returning id`,
    [
      ownerId, source, externalId, canonicalUrl, input.title, input.description ?? null, input.askingPriceCents, input.category ?? null,
      input.condition ?? null, input.sellerName ?? null, input.locationText ?? null, input.locationPrecision ?? "unknown",
      input.shippingAvailable ?? null, input.importMethod, fingerprint, input.raw ?? null, input.importMethod === "api" ? 0.95 : 0.8,
    ],
  );
  const listingId = listing!.id;
  await q.query(`insert into listing_price_history (owner_id, listing_id, price_cents) values ($1, $2, $3)`, [ownerId, listingId, input.askingPriceCents]);
  await q.query(`insert into listing_observations (owner_id, listing_id, status, price_cents) values ($1, $2, 'active', $3)`, [ownerId, listingId, input.askingPriceCents]);

  const [opp] = await q.query<{ id: string }>(
    `insert into opportunities (owner_id, listing_id, title, category, asking_price_cents, status, channel)
     values ($1, $2, $3, $4, $5, 'discovered', 'ebay_us') returning id`,
    [ownerId, listingId, input.title, input.category ?? null, input.askingPriceCents],
  );
  const opportunityId = opp!.id;
  await q.query(`insert into opportunity_status_events (owner_id, opportunity_id, to_status, note) values ($1, $2, 'discovered', $3)`, [
    ownerId,
    opportunityId,
    `Imported via ${input.importMethod}`,
  ]);

  // Fuzzy duplicate check against recent listings.
  const recent = await q.query<{ id: string; opp_id: string; title: string; fingerprint: ListingFingerprint }>(
    `select l.id, o.id as opp_id, l.title, l.fingerprint from source_listings l join opportunities o on o.listing_id = l.id
      where l.owner_id = $1 and l.id <> $2 and l.first_seen_at > now() - interval '60 days' order by l.first_seen_at desc limit 200`,
    [ownerId, listingId],
  );
  const possibleDuplicates: ImportResult["possibleDuplicates"] = [];
  for (const r of recent) {
    const a = assessDuplicate({ ...fingerprint, id: listingId }, { ...(r.fingerprint ?? {}), id: r.id, title: r.title } as ListingFingerprint);
    if (a.kind === "relist_or_crosspost" || a.kind === "possible") {
      await q.query(
        `insert into listing_deduplication_links (owner_id, listing_id, duplicate_of_id, kind, signals, score) values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
        [ownerId, listingId, r.id, a.kind, JSON.stringify(a.signals), a.score],
      );
      possibleDuplicates.push({ opportunityId: r.opp_id, title: r.title, signals: a.signals });
    }
  }

  await audit(q, ownerId, "listing.imported", "opportunity", opportunityId, { source, importMethod: input.importMethod });
  await reevaluate(q, ownerId, opportunityId);
  return { opportunityId, listingId, duplicateOf: null, possibleDuplicates };
}

/* --------------------------------- detail --------------------------------- */

export interface OpportunityRow {
  id: string;
  listing_id: string | null;
  title: string;
  category: string | null;
  status: OpportunityStatus;
  decision: Decision | null;
  requires_manual_review: boolean;
  score: number | null;
  asking_price_cents: number;
  max_purchase_cents: number | null;
  conservative_net_cents: number | null;
  base_net_cents: number | null;
  conservative_roi_bps: number | null;
  one_way_minutes: number | null;
  identity_status: "verified" | "probable" | "unverified";
  identity_confidence: number;
  authenticity_status: "verified" | "not_required" | "unverified" | "failed";
  condition_confidence: number;
  functionality_tested: boolean;
  hidden_gem_flag: boolean;
  hidden_gem_rationale: string | null;
  hidden_gem_potential_high_cents: number | null;
  rare_item: boolean;
  channel: "ebay_us" | "local_cash";
  shipping_label_cents: number;
  packaging_cents: number | null;
  inbound_shipping_cents: number;
  repair_estimate_cents: number;
  pickup_minutes: number | null;
  notes: string | null;
  evaluation_version: number;
  evaluated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ListingRow {
  id: string;
  source: string;
  external_id: string | null;
  canonical_url: string | null;
  title: string;
  description: string | null;
  asking_price_cents: number;
  condition: string | null;
  seller_name: string | null;
  location_text: string | null;
  location_precision: "exact" | "approximate" | "unknown";
  status: string;
  import_method: string;
  first_seen_at: Date;
  last_observed_at: Date;
}

export interface CompRow {
  id: string;
  product_identity: string;
  source: string;
  source_url: string | null;
  sale_date: Date | string | null;
  price_cents: number;
  shipping_cents: number | null;
  total_price_cents: number;
  condition: string | null;
  variant: string | null;
  grade: string | null;
  evidence_type: EvidenceType;
  match_confidence: number;
  variant_match: boolean;
  condition_match: ConditionMatch;
  excluded: boolean;
  notes: string | null;
  last_verified_at: Date;
}

export interface OpportunityDetail {
  opportunity: OpportunityRow;
  listing: ListingRow | null;
  images: { id: string; storage_path: string | null; source_url: string | null; origin: string }[];
  comps: CompRow[];
  liquidity: { sold_count_90d: number | null; active_count: number | null; source: string; source_url: string | null; observed_at: Date } | null;
  route: (RouteEstimate & { destination_text: string | null }) | null;
  riskFactors: (RiskFactor & { id: string; source: string })[];
  candidates: {
    id: string; product_name: string; brand: string | null; model: string | null; variant: string | null; manufacturing_period: string | null;
    identification_confidence: number; variant_confidence: number | null; rationale: string | null; authenticity_concerns: string | null;
    potential_value_low_cents: number | null; potential_value_high_cents: number | null; required_photos: string[]; status: string; source: string;
  }[];
  priceHistory: { price_cents: number; observed_at: Date }[];
  evaluation: Evaluation | null;
  statusEvents: { from_status: string | null; to_status: string; note: string | null; created_at: Date }[];
}

function mapOpp(r: Record<string, unknown>): OpportunityRow {
  return {
    ...(r as unknown as OpportunityRow),
    asking_price_cents: num(r.asking_price_cents),
    max_purchase_cents: numOrNull(r.max_purchase_cents),
    conservative_net_cents: numOrNull(r.conservative_net_cents),
    base_net_cents: numOrNull(r.base_net_cents),
    conservative_roi_bps: numOrNull(r.conservative_roi_bps),
    one_way_minutes: numOrNull(r.one_way_minutes),
    identity_confidence: num(r.identity_confidence),
    condition_confidence: num(r.condition_confidence),
    score: numOrNull(r.score),
    hidden_gem_potential_high_cents: numOrNull(r.hidden_gem_potential_high_cents),
    shipping_label_cents: num(r.shipping_label_cents),
    packaging_cents: numOrNull(r.packaging_cents),
    inbound_shipping_cents: num(r.inbound_shipping_cents),
    repair_estimate_cents: num(r.repair_estimate_cents),
    pickup_minutes: numOrNull(r.pickup_minutes),
  };
}

export async function getOpportunityDetail(q: Queryable, ownerId: string, id: string): Promise<OpportunityDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [o] = await q.query(`select * from opportunities where id = $1 and owner_id = $2`, [id, ownerId]);
  if (!o) return null;
  const opportunity = mapOpp(o);
  const [listing] = opportunity.listing_id ? await q.query<ListingRow & Record<string, unknown>>(`select * from source_listings where id = $1`, [opportunity.listing_id]) : [];
  const images = opportunity.listing_id
    ? await q.query<OpportunityDetail["images"][number]>(`select id, storage_path, source_url, origin from listing_images where listing_id = $1 order by position, created_at`, [opportunity.listing_id])
    : [];
  const comps = (await q.query<CompRow & Record<string, unknown>>(`select * from comparable_sales where opportunity_id = $1 order by sale_date desc nulls last, created_at desc`, [id])).map((c) => ({
    ...c,
    price_cents: num(c.price_cents),
    shipping_cents: numOrNull(c.shipping_cents),
    total_price_cents: num(c.total_price_cents),
    match_confidence: num(c.match_confidence),
  }));
  const [liq] = await q.query<Record<string, unknown>>(`select * from liquidity_estimates where opportunity_id = $1 order by observed_at desc limit 1`, [id]);
  const [route] = await q.query<Record<string, unknown>>(`select * from route_estimates where opportunity_id = $1 order by computed_at desc limit 1`, [id]);
  const risks = await q.query<Record<string, unknown>>(`select * from opportunity_risk_factors where opportunity_id = $1 order by created_at`, [id]);
  const candidates = await q.query<Record<string, unknown>>(
    `select * from item_identity_candidates where opportunity_id = $1 and status <> 'rejected' order by status = 'confirmed' desc, identification_confidence desc`,
    [id],
  );
  const priceHistory = opportunity.listing_id
    ? (await q.query<{ price_cents: number; observed_at: Date }>(`select price_cents, observed_at from listing_price_history where listing_id = $1 order by observed_at`, [opportunity.listing_id])).map((p) => ({ ...p, price_cents: num(p.price_cents) }))
    : [];
  const [evalRow] = await q.query<{ result: Evaluation }>(`select result from opportunity_evaluations where opportunity_id = $1 order by version desc limit 1`, [id]);
  const statusEvents = await q.query<OpportunityDetail["statusEvents"][number]>(
    `select from_status, to_status, note, created_at from opportunity_status_events where opportunity_id = $1 order by created_at desc limit 50`,
    [id],
  );

  return {
    opportunity,
    listing: listing ? { ...listing, asking_price_cents: num(listing.asking_price_cents) } : null,
    images,
    comps,
    liquidity: liq
      ? { sold_count_90d: numOrNull(liq.sold_count_90d), active_count: numOrNull(liq.active_count), source: String(liq.source), source_url: (liq.source_url as string) ?? null, observed_at: liq.observed_at as Date }
      : null,
    route: route
      ? {
          source: route.source as RouteEstimate["source"],
          precision: route.precision as RouteEstimate["precision"],
          trafficAware: !!route.traffic_aware,
          oneWayMinutes: numOrNull(route.one_way_minutes),
          oneWayMiles: numOrNull(route.one_way_miles),
          tollsCents: num(route.tolls_cents),
          parkingCents: num(route.parking_cents),
          computedAt: route.computed_at ? new Date(route.computed_at as string).toISOString() : null,
          destination_text: (route.destination_text as string) ?? null,
        }
      : null,
    riskFactors: risks.map((r) => ({
      id: String(r.id),
      code: String(r.code),
      severity: r.severity as RiskFactor["severity"],
      title: String(r.title),
      detail: String(r.detail ?? ""),
      allowanceBps: num(r.allowance_bps),
      resolved: !!r.resolved,
      source: String(r.source),
    })),
    candidates: candidates.map((c) => ({
      ...(c as unknown as OpportunityDetail["candidates"][number]),
      identification_confidence: num(c.identification_confidence),
      variant_confidence: numOrNull(c.variant_confidence),
      potential_value_low_cents: numOrNull(c.potential_value_low_cents),
      potential_value_high_cents: numOrNull(c.potential_value_high_cents),
      required_photos: (c.required_photos as string[]) ?? [],
    })),
    priceHistory,
    evaluation: evalRow?.result ?? null,
    statusEvents,
  };
}

/* ------------------------------- evaluation -------------------------------- */

export function buildEvaluationInput(d: OpportunityDetail, buyingPowerCents: number | null): OpportunityInput {
  const o = d.opportunity;
  const comps: Comparable[] = d.comps.map((c) => ({
    id: c.id,
    evidenceType: c.evidence_type,
    totalPriceCents: c.total_price_cents,
    saleDate: c.sale_date ? new Date(c.sale_date).toISOString() : null,
    matchConfidence: c.match_confidence,
    variantMatch: c.variant_match,
    conditionMatch: c.condition_match,
    excludedByUser: c.excluded,
    sourceUrl: c.source_url,
  }));
  return {
    askingPriceCents: o.asking_price_cents,
    category: o.category,
    listingAvailable: !["unavailable", "expired", "sold_by_other"].includes(o.status) && d.listing?.status !== "sold" && d.listing?.status !== "unavailable",
    identity: { status: o.identity_status, confidence: o.identity_confidence },
    authenticity: o.authenticity_status,
    conditionConfidence: o.condition_confidence,
    functionalityTested: o.functionality_tested,
    comps,
    liquidity: { soldCount90d: d.liquidity?.sold_count_90d ?? null, activeCount: d.liquidity?.active_count ?? null, rareItem: o.rare_item },
    route: d.route ?? { source: "unknown", precision: "unknown", trafficAware: false, oneWayMinutes: null, oneWayMiles: null, tollsCents: 0, parkingCents: 0, computedAt: null },
    pickupMinutes: o.pickup_minutes ?? undefined,
    extraAcquisition: { inboundShippingCents: o.inbound_shipping_cents, repairCents: o.repair_estimate_cents },
    shippingLabelCents: o.shipping_label_cents,
    packagingCents: o.packaging_cents ?? undefined,
    channel: o.channel,
    manualRiskFactors: d.riskFactors,
    hiddenGem: o.hidden_gem_flag ? { flagged: true, potentialHighCents: o.hidden_gem_potential_high_cents, rationale: o.hidden_gem_rationale ?? "Potential overlooked value." } : null,
    buyingPowerCents,
    listingObservedAt: d.listing?.last_observed_at ? new Date(d.listing.last_observed_at).toISOString() : null,
  };
}

const DECISION_STATUS: Partial<Record<Decision, OpportunityStatus>> = {
  STRONG_BUY: "qualified",
  WORTH_THE_DRIVE: "qualified",
  BUY_IF_NEGOTIATED: "qualified",
  RESEARCH_REQUIRED: "research_required",
  HIDDEN_GEM: "researching",
  UNAVAILABLE: "unavailable",
};
const LOCKED_STATUSES = new Set<OpportunityStatus>(["negotiating", "purchased", "listed", "sold", "passed", "duplicate", "sold_by_other", "expired", "suspicious"]);

export async function setStatus(q: Queryable, ownerId: string, id: string, to: OpportunityStatus, note: string | null = null) {
  const [cur] = await q.query<{ status: OpportunityStatus }>(`select status from opportunities where id = $1 and owner_id = $2`, [id, ownerId]);
  if (!cur || cur.status === to) return;
  await q.query(`update opportunities set status = $2, updated_at = now() where id = $1`, [id, to]);
  await q.query(`insert into opportunity_status_events (owner_id, opportunity_id, from_status, to_status, note) values ($1,$2,$3,$4,$5)`, [ownerId, id, cur.status, to, note]);
}

/** Runs the deterministic engine and stores a new evaluation version. */
export async function reevaluate(q: Queryable, ownerId: string, id: string, settingsIn?: BusinessSettings): Promise<Evaluation | null> {
  const detail = await getOpportunityDetail(q, ownerId, id);
  if (!detail) return null;
  const settings = settingsIn ?? (await getSettings(q, ownerId)).settings;
  const bp = await getBuyingPower(q, ownerId, settings);
  const input = buildEvaluationInput(detail, bp.summary.contributedCents > 0 ? bp.availableCents : null);
  const ev = evaluateOpportunity(input, settings);
  const version = detail.opportunity.evaluation_version + 1;

  const [evalRow] = await q.query<{ id: string }>(
    `insert into opportunity_evaluations (owner_id, opportunity_id, version, decision, score, engine_version, input, result)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [ownerId, id, version, ev.decision, ev.score, ENGINE_VERSION, input, ev],
  );
  for (const s of ev.scenariosAtAsking ?? []) {
    await q.query(`insert into opportunity_scenarios (owner_id, evaluation_id, name, net_profit_cents, cash_roi_bps, data) values ($1,$2,$3,$4,$5,$6)`, [
      ownerId, evalRow!.id, s.name, s.result.netProfitCents, s.result.cashRoiBps, s,
    ]);
  }
  if (ev.valuation.status === "valued") {
    const [prev] = await q.query<{ conservative_cents: number | null }>(`select conservative_cents from market_valuations where opportunity_id = $1 order by version desc limit 1`, [id]);
    await q.query(
      `insert into market_valuations (owner_id, opportunity_id, version, conservative_cents, base_cents, optimistic_cents, sample_size, evidence_strength, data, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + interval '14 days')`,
      [ownerId, id, version, ev.valuation.conservativeCents, ev.valuation.baseCents, ev.valuation.optimisticCents, ev.valuation.sampleSize, ev.valuation.evidenceStrength, ev.valuation],
    );
    if (prev && numOrNull(prev.conservative_cents) !== ev.valuation.conservativeCents) {
      await q.query(`insert into valuation_revisions (owner_id, opportunity_id, previous_conservative_cents, new_conservative_cents, reason) values ($1,$2,$3,$4,'Comparable evidence changed')`, [
        ownerId, id, numOrNull(prev.conservative_cents), ev.valuation.conservativeCents,
      ]);
    }
  }
  const conservative = ev.scenariosAtAsking?.find((s) => s.name === "conservative")?.result;
  const base = ev.scenariosAtAsking?.find((s) => s.name === "base")?.result;
  await q.query(
    `update opportunities set decision = $2, score = $3, max_purchase_cents = $4, conservative_net_cents = $5, base_net_cents = $6,
       conservative_roi_bps = $7, one_way_minutes = $8, requires_manual_review = $9, evaluation_version = $10, evaluated_at = now(), updated_at = now()
     where id = $1`,
    [id, ev.decision, ev.score, ev.maxPurchasePriceCents, conservative?.netProfitCents ?? null, base?.netProfitCents ?? null, conservative?.cashRoiBps ?? null, ev.travel.oneWayMinutes, ev.requiresManualReview, version],
  );

  const nextStatus = DECISION_STATUS[ev.decision];
  const researchStates = new Set<OpportunityStatus>(["researching", "research_required", "identified"]);
  const pingPong = nextStatus && researchStates.has(nextStatus) && researchStates.has(detail.opportunity.status);
  if (nextStatus && !pingPong && !LOCKED_STATUSES.has(detail.opportunity.status)) await setStatus(q, ownerId, id, nextStatus, `Engine: ${DECISION_LABELS[ev.decision]}`);

  // Alert only when evidence and thresholds are satisfied; hidden gems are low priority research prompts.
  const o = detail.opportunity;
  if (!LOCKED_STATUSES.has(o.status)) {
    if (ev.decision === "STRONG_BUY" || ev.decision === "WORTH_THE_DRIVE") {
      await createAlert(q, ownerId, {
        kind: ev.decision === "STRONG_BUY" ? "strong_buy" : "worth_the_drive",
        priority: "high",
        title: `${DECISION_LABELS[ev.decision]}: ${o.title}`,
        body: [
          `Asking ${formatCents(o.asking_price_cents)}`,
          ev.offers ? `Suggested offer ${formatCents(ev.offers.openingOfferCents)}` : null,
          conservative ? `Conservative net ${formatCents(conservative.netProfitCents)} (${formatBps(conservative.cashRoiBps)} ROI)` : null,
          ev.travel.oneWayMinutes !== null ? `${ev.travel.oneWayMinutes} min drive${ev.travel.status === "provisional" ? " (provisional)" : ""}` : null,
          `${ev.valuation.sampleSize} sold comps`,
          ev.requiresManualReview ? "Manual review required" : null,
        ].filter(Boolean).join(" | "),
        link: `/deals/${id}`,
        opportunityId: id,
        dedupeKey: `${ev.decision}:${id}:${o.asking_price_cents}`,
      });
    } else if (ev.decision === "HIDDEN_GEM") {
      await createAlert(q, ownerId, {
        kind: "hidden_gem",
        priority: "low",
        title: `Hidden gem candidate: ${o.title}`,
        body: "Potential overlooked value. Verification required before any purchase.",
        link: `/gems/${id}`,
        opportunityId: id,
        dedupeKey: `HIDDEN_GEM:${id}`,
      });
    }
  }
  return ev;
}

/* ---------------------------------- feed ---------------------------------- */

export interface FeedFilters {
  decision?: Decision | "ACTIONABLE" | null;
  status?: OpportunityStatus | "OPEN" | null;
  category?: string | null;
  minNetCents?: number | null;
  minRoiBps?: number | null;
  maxMinutes?: number | null;
  search?: string | null;
  sort?: "score" | "profit" | "roi" | "recent" | "drive";
  limit?: number;
}

export interface FeedItem extends OpportunityRow {
  source: string | null;
  location_text: string | null;
  thumb: string | null;
  canonical_url: string | null;
}

export async function listFeed(q: Queryable, ownerId: string, f: FeedFilters = {}): Promise<FeedItem[]> {
  const where: string[] = ["o.owner_id = $1"];
  const params: unknown[] = [ownerId];
  const add = (clause: string, v: unknown) => {
    params.push(v);
    where.push(clause.replace("?", `$${params.length}`));
  };
  if (f.decision === "ACTIONABLE") where.push(`o.decision in ('STRONG_BUY','WORTH_THE_DRIVE','BUY_IF_NEGOTIATED')`);
  else if (f.decision) add("o.decision = ?", f.decision);
  if (f.status === "OPEN") where.push(`o.status not in ('passed','expired','sold_by_other','unavailable','duplicate','sold','purchased','listed')`);
  else if (f.status) add("o.status = ?", f.status);
  if (f.category) add("o.category = ?", f.category);
  if (f.minNetCents != null) add("o.conservative_net_cents >= ?", f.minNetCents);
  if (f.minRoiBps != null) add("o.conservative_roi_bps >= ?", f.minRoiBps);
  if (f.maxMinutes != null) add("(o.one_way_minutes is null or o.one_way_minutes <= ?)", f.maxMinutes);
  if (f.search) add("o.title ilike ?", `%${f.search.replace(/[%_]/g, "")}%`);
  const order = {
    score: "o.score desc nulls last, o.created_at desc",
    profit: "o.conservative_net_cents desc nulls last",
    roi: "o.conservative_roi_bps desc nulls last",
    recent: "o.created_at desc",
    drive: "o.one_way_minutes asc nulls last",
  }[f.sort ?? "score"];
  params.push(Math.min(f.limit ?? 100, 500));
  const rows = await q.query<Record<string, unknown>>(
    `select o.*, l.source, l.location_text, l.canonical_url,
       (select storage_path from listing_images i where i.listing_id = o.listing_id order by position, created_at limit 1) as thumb
       from opportunities o left join source_listings l on l.id = o.listing_id
      where ${where.join(" and ")} order by ${order} limit $${params.length}`,
    params,
  );
  return rows.map((r) => ({ ...mapOpp(r), source: (r.source as string) ?? null, location_text: (r.location_text as string) ?? null, thumb: (r.thumb as string) ?? null, canonical_url: (r.canonical_url as string) ?? null }));
}
