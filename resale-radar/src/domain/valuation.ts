import { roundHalfAway, type Cents } from "./money";

/**
 * Comparable-sales valuation.
 *
 * Only sold transactions feed the price estimate. Active asking prices, price
 * guides, auction estimates, and AI estimates are kept as context and are
 * never silently substituted for sold data.
 */

export const EVIDENCE_TYPES = [
  "sold_verified",
  "sold_user_recorded",
  "completed_uncertain",
  "active_listing",
  "price_guide",
  "auction_estimate",
  "ai_estimate",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_LABELS: Record<EvidenceType, string> = {
  sold_verified: "Verified sold (provider)",
  sold_user_recorded: "Sold (recorded by you)",
  completed_uncertain: "Completed, outcome uncertain",
  active_listing: "Active asking price",
  price_guide: "Historical price guide",
  auction_estimate: "Auction estimate",
  ai_estimate: "AI estimate",
};

export const SOLD_EVIDENCE: ReadonlySet<EvidenceType> = new Set(["sold_verified", "sold_user_recorded"]);

export type ConditionMatch = "exact" | "better" | "worse" | "unknown";

export interface Comparable {
  id: string;
  evidenceType: EvidenceType;
  /** Total the buyer paid for the item and shipping, excluding tax. */
  totalPriceCents: Cents;
  saleDate: string | null;
  matchConfidence: number;
  variantMatch: boolean;
  conditionMatch: ConditionMatch;
  excludedByUser?: boolean;
  sourceUrl?: string | null;
}

export interface ValuationSettings {
  minMatchConfidence: number;
  maxCompAgeDays: number;
  /** Modified z-score cutoff for outlier rejection. */
  outlierZ: number;
  trimFraction: number;
}

export const DEFAULT_VALUATION_SETTINGS: ValuationSettings = {
  minMatchConfidence: 0.6,
  maxCompAgeDays: 180,
  outlierZ: 3.5,
  trimFraction: 0.1,
};

export type EvidenceStrength = "strong" | "moderate" | "thin" | "none";

export interface CompExclusion {
  id: string;
  reason: string;
}

export interface Valuation {
  status: "valued" | "insufficient";
  evidenceStrength: EvidenceStrength;
  sampleSize: number;
  usedCompIds: string[];
  excluded: CompExclusion[];
  medianCents: Cents | null;
  trimmedMeanCents: Cents | null;
  lowCents: Cents | null;
  highCents: Cents | null;
  p25Cents: Cents | null;
  p75Cents: Cents | null;
  conservativeCents: Cents | null;
  baseCents: Cents | null;
  optimisticCents: Cents | null;
  medianAgeDays: number | null;
  /** Price trend in bps per 30 days from a least-squares fit. Null with fewer than 4 dated comps. */
  trendBpsPer30d: number | null;
  /** Interquartile range divided by median, in bps. */
  dispersionBps: number | null;
  confidence: number;
  contextOnly: { type: EvidenceType; count: number; medianCents: Cents | null }[];
  notes: string[];
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Linear-interpolated percentile, p in [0, 1]. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo]! + (s[hi]! - s[lo]!) * (idx - lo);
}

export function trimmedMean(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const k = Math.floor(s.length * fraction);
  const kept = s.slice(k, s.length - k);
  const arr = kept.length ? kept : s;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86_400_000;
}

export function valueFromComparables(
  comps: readonly Comparable[],
  now: Date,
  settings: ValuationSettings = DEFAULT_VALUATION_SETTINGS,
): Valuation {
  const excluded: CompExclusion[] = [];
  const notes: string[] = [];
  const candidates: { comp: Comparable; ageDays: number | null }[] = [];

  for (const comp of comps) {
    if (comp.excludedByUser) {
      excluded.push({ id: comp.id, reason: "Excluded by you" });
      continue;
    }
    if (!SOLD_EVIDENCE.has(comp.evidenceType)) continue;
    if (comp.matchConfidence < settings.minMatchConfidence) {
      excluded.push({ id: comp.id, reason: `Match confidence ${(comp.matchConfidence * 100).toFixed(0)}% is below the minimum` });
      continue;
    }
    if (!comp.variantMatch) {
      excluded.push({ id: comp.id, reason: "Different variant" });
      continue;
    }
    if (comp.conditionMatch === "better") {
      excluded.push({ id: comp.id, reason: "Comparable is in better condition than this item" });
      continue;
    }
    let ageDays: number | null = null;
    if (comp.saleDate) {
      ageDays = daysBetween(new Date(comp.saleDate), now);
      if (ageDays > settings.maxCompAgeDays) {
        excluded.push({ id: comp.id, reason: `Older than ${settings.maxCompAgeDays} days` });
        continue;
      }
    } else {
      notes.push("Some sold comparables have no sale date.");
    }
    if (comp.totalPriceCents <= 0) {
      excluded.push({ id: comp.id, reason: "No transaction price" });
      continue;
    }
    candidates.push({ comp, ageDays });
  }

  // Outlier rejection with the median absolute deviation (robust to a few bad comps).
  let kept = candidates;
  if (candidates.length >= 4) {
    const prices = candidates.map((c) => c.comp.totalPriceCents);
    const med = median(prices)!;
    const mad = median(prices.map((p) => Math.abs(p - med)))!;
    if (mad > 0) {
      kept = [];
      for (const c of candidates) {
        const z = (0.6745 * (c.comp.totalPriceCents - med)) / mad;
        if (Math.abs(z) > settings.outlierZ) excluded.push({ id: c.comp.id, reason: "Statistical outlier" });
        else kept.push(c);
      }
    }
  }

  const contextOnly = (["completed_uncertain", "active_listing", "price_guide", "auction_estimate", "ai_estimate"] as const)
    .map((type) => {
      const prices = comps.filter((c) => c.evidenceType === type && !c.excludedByUser).map((c) => c.totalPriceCents);
      const m = median(prices);
      return { type, count: prices.length, medianCents: m === null ? null : roundHalfAway(m) };
    })
    .filter((c) => c.count > 0);

  const n = kept.length;
  if (n === 0) {
    return {
      status: "insufficient",
      evidenceStrength: "none",
      sampleSize: 0,
      usedCompIds: [],
      excluded,
      medianCents: null,
      trimmedMeanCents: null,
      lowCents: null,
      highCents: null,
      p25Cents: null,
      p75Cents: null,
      conservativeCents: null,
      baseCents: null,
      optimisticCents: null,
      medianAgeDays: null,
      trendBpsPer30d: null,
      dispersionBps: null,
      confidence: 0,
      contextOnly,
      notes: [
        "No qualifying sold transactions. Active listings and estimates are shown for context only and are not used as resale value.",
        ...notes,
      ],
    };
  }

  const prices = kept.map((k) => k.comp.totalPriceCents);
  const med = median(prices)!;
  const p25 = percentile(prices, 0.25)!;
  const p75 = percentile(prices, 0.75)!;
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const tmean = trimmedMean(prices, settings.trimFraction)!;
  const evidenceStrength: EvidenceStrength = n >= 8 ? "strong" : n >= 4 ? "moderate" : "thin";

  // Thin evidence widens the range: conservative falls back to the lowest sale.
  const conservative = evidenceStrength === "thin" ? low : Math.min(p25, med);
  const optimistic = evidenceStrength === "thin" ? med : p75;
  if (evidenceStrength === "thin") notes.push(`Only ${n} qualifying sale${n === 1 ? "" : "s"}. Range is wide and the conservative value uses the lowest sale.`);

  const ages = kept.map((k) => k.ageDays).filter((a): a is number => a !== null);
  const medianAgeDays = median(ages);

  let trendBpsPer30d: number | null = null;
  const dated = kept.filter((k) => k.ageDays !== null);
  if (dated.length >= 4) {
    const xs = dated.map((d) => -d.ageDays!);
    const ys = dated.map((d) => d.comp.totalPriceCents);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i]! - mx) * (ys[i]! - my);
      den += (xs[i]! - mx) ** 2;
    }
    if (den > 0 && my > 0) trendBpsPer30d = Math.round(((num / den) * 30 * 10_000) / my);
  }

  const dispersionBps = med > 0 ? Math.round(((p75 - p25) / med) * 10_000) : null;
  const avgMatch = kept.reduce((a, k) => a + k.comp.matchConfidence, 0) / n;
  const sizeFactor = Math.min(1, n / 8);
  const dispersionFactor = dispersionBps === null ? 0.5 : Math.max(0, 1 - dispersionBps / 10_000);
  const recencyFactor = medianAgeDays === null ? 0.6 : Math.max(0.3, 1 - medianAgeDays / (settings.maxCompAgeDays * 1.5));
  const userOnly = kept.every((k) => k.comp.evidenceType === "sold_user_recorded");
  const confidence = Math.round(sizeFactor * dispersionFactor * recencyFactor * avgMatch * (userOnly ? 0.9 : 1) * 100) / 100;

  return {
    status: "valued",
    evidenceStrength,
    sampleSize: n,
    usedCompIds: kept.map((k) => k.comp.id),
    excluded,
    medianCents: roundHalfAway(med),
    trimmedMeanCents: roundHalfAway(tmean),
    lowCents: low,
    highCents: high,
    p25Cents: roundHalfAway(p25),
    p75Cents: roundHalfAway(p75),
    conservativeCents: roundHalfAway(conservative),
    baseCents: roundHalfAway(med),
    optimisticCents: roundHalfAway(optimistic),
    medianAgeDays: medianAgeDays === null ? null : Math.round(medianAgeDays),
    trendBpsPer30d,
    dispersionBps,
    confidence,
    contextOnly,
    notes,
  };
}
