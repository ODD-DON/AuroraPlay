import { roundHalfAway, type Bps } from "./money";

/**
 * Sell-through and liquidity. The sold-to-active ratio is a demand indicator,
 * not a probability of selling. When evidence is insufficient the answer is
 * "unknown" rather than an invented number.
 */

export type LiquidityClass = "highly_liquid" | "liquid" | "moderate" | "slow_moving" | "speculative" | "unknown";

export const LIQUIDITY_LABELS: Record<LiquidityClass, string> = {
  highly_liquid: "Highly liquid",
  liquid: "Liquid",
  moderate: "Moderate",
  slow_moving: "Slow-moving",
  speculative: "Speculative",
  unknown: "Unknown",
};

export interface DemandBand {
  minRatioBps: Bps;
  label: string;
}

/** Configurable screening bands. These are rules of thumb, not statistical truths. */
export const DEFAULT_DEMAND_BANDS: DemandBand[] = [
  { minRatioBps: 10_000, label: "Strong demand indicator" },
  { minRatioBps: 6_000, label: "Favorable" },
  { minRatioBps: 3_000, label: "Moderate" },
  { minRatioBps: 1_000, label: "Weak" },
  { minRatioBps: 0, label: "Very weak" },
];

export interface LiquidityInput {
  soldCount90d: number | null;
  activeCount: number | null;
  /** True for one-of-one or rare items where ratios are not meaningful. */
  rareItem: boolean;
  /** Owner's own median days-to-sell in this category, when known from history. */
  historicalMedianDaysToSell?: number | null;
  historicalSampleSize?: number;
}

export interface LiquidityEstimate {
  classification: LiquidityClass;
  soldToActiveRatioBps: Bps | null;
  demandLabel: string;
  daysToSellLow: number | null;
  daysToSellHigh: number | null;
  daysToSellBase: number | null;
  basis: "market_ratio" | "owner_history" | "blended" | "none";
  notes: string[];
}

export function demandLabel(ratioBps: Bps | null, bands: readonly DemandBand[] = DEFAULT_DEMAND_BANDS): string {
  if (ratioBps === null) return "Unknown";
  const sorted = [...bands].sort((a, b) => b.minRatioBps - a.minRatioBps);
  return sorted.find((b) => ratioBps >= b.minRatioBps)?.label ?? "Unknown";
}

export function estimateLiquidity(input: LiquidityInput, bands: readonly DemandBand[] = DEFAULT_DEMAND_BANDS): LiquidityEstimate {
  const notes: string[] = [];
  const { soldCount90d: sold, activeCount: active } = input;

  if (sold === null || active === null) {
    return {
      classification: "unknown",
      soldToActiveRatioBps: null,
      demandLabel: "Unknown",
      daysToSellLow: null,
      daysToSellHigh: null,
      daysToSellBase: null,
      basis: "none",
      notes: ["Sold and active counts are both required. Record them in Market Research."],
    };
  }

  let ratioBps: Bps | null;
  if (active === 0) ratioBps = sold > 0 ? 99_900 : null;
  else ratioBps = roundHalfAway((sold * 10_000) / active);

  let classification: LiquidityClass;
  if (input.rareItem) {
    classification = sold >= 3 ? "slow_moving" : "speculative";
    notes.push("Rare or one-of-one item: sell-through ratios are not meaningful, so it is evaluated as slow-moving or speculative.");
  } else if (ratioBps === null) classification = "unknown";
  else if (ratioBps >= 10_000 && sold >= 10) classification = "highly_liquid";
  else if (ratioBps >= 6_000 && sold >= 5) classification = "liquid";
  else if (ratioBps >= 3_000 && sold >= 3) classification = "moderate";
  else if (ratioBps >= 1_000 && sold >= 2) classification = "slow_moving";
  else classification = "speculative";

  // Days of inventory: how long the current active supply lasts at the observed sale rate.
  // A competitively priced listing usually sells before the average listing, so the base
  // case is half the days of inventory. This is a heuristic and is labeled as such.
  let low: number | null = null;
  let high: number | null = null;
  let base: number | null = null;
  let basis: LiquidityEstimate["basis"] = "none";
  if (sold >= 3 && !input.rareItem) {
    const doi = active === 0 ? 7 : (90 * active) / sold;
    low = Math.max(1, Math.round(doi * 0.25));
    base = Math.max(2, Math.round(doi * 0.5));
    high = Math.min(180, Math.max(base + 1, Math.round(doi * 1.0)));
    basis = "market_ratio";
    notes.push("Time to sale is estimated from days of active inventory at the observed sale rate, assuming competitive pricing.");
  } else {
    notes.push("Not enough sales to estimate time to sale.");
  }

  const hist = input.historicalMedianDaysToSell;
  if (hist && (input.historicalSampleSize ?? 0) >= 5) {
    if (base === null) {
      base = Math.round(hist);
      low = Math.max(1, Math.round(hist * 0.5));
      high = Math.round(hist * 2);
      basis = "owner_history";
    } else {
      base = Math.round((base + hist) / 2);
      low = Math.min(low!, Math.round(hist * 0.5));
      high = Math.max(high!, Math.round(hist * 1.5));
      basis = "blended";
    }
    notes.push(`Blended with your own median of ${Math.round(hist)} days to sell in this category.`);
  }

  return {
    classification,
    soldToActiveRatioBps: ratioBps,
    demandLabel: input.rareItem ? "Not applicable (rare item)" : demandLabel(ratioBps, bands),
    daysToSellLow: low,
    daysToSellHigh: high,
    daysToSellBase: base,
    basis,
    notes,
  };
}
