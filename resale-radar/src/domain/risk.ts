import { applyBps, type Bps, type Cents } from "./money";

/**
 * Risk factors. Each factor has a severity and an optional dollar allowance.
 * Critical factors block a strong-buy classification until resolved.
 */

export type RiskSeverity = "critical" | "high" | "medium" | "low";

export interface RiskFactor {
  code: string;
  severity: RiskSeverity;
  title: string;
  detail: string;
  /** Additional allowance as bps of expected sale value. */
  allowanceBps: Bps;
  resolved: boolean;
}

export const RISK_CATALOG: Record<string, Omit<RiskFactor, "resolved" | "detail"> & { detail: string }> = {
  identity_unverified: { code: "identity_unverified", severity: "critical", title: "Identity not verified", detail: "The exact product, model, or variant has not been confirmed.", allowanceBps: 0 },
  authenticity_unverified: { code: "authenticity_unverified", severity: "critical", title: "Authenticity not verified", detail: "Item category has meaningful counterfeit or reproduction risk and no authentication evidence is recorded.", allowanceBps: 0 },
  possible_stolen: { code: "possible_stolen", severity: "critical", title: "Possible stolen property", detail: "Indicators such as removed serials, new-in-box at a fraction of retail, or seller unwilling to show proof.", allowanceBps: 0 },
  suspicious_payment: { code: "suspicious_payment", severity: "critical", title: "Unusual payment request", detail: "Seller requests a deposit, gift cards, or off-platform payment before inspection.", allowanceBps: 0 },
  activation_lock: { code: "activation_lock", severity: "critical", title: "Device lock not cleared", detail: "Activation Lock, MDM, or account lock status is unknown.", allowanceBps: 0 },
  untested_electronics: { code: "untested_electronics", severity: "high", title: "Functionality untested", detail: "Electronics have not been confirmed working.", allowanceBps: 800 },
  condition_unclear: { code: "condition_unclear", severity: "medium", title: "Condition unclear from photos", detail: "Photos do not show key surfaces, corners, screens, or ports.", allowanceBps: 400 },
  missing_accessories: { code: "missing_accessories", severity: "medium", title: "Accessories may be missing", detail: "Controllers, chargers, manuals, or original packaging may be absent.", allowanceBps: 300 },
  thin_comps: { code: "thin_comps", severity: "medium", title: "Few comparable sales", detail: "Fewer than four qualifying sold comparables.", allowanceBps: 300 },
  stale_comps: { code: "stale_comps", severity: "low", title: "Comparables are aging", detail: "Median comparable is more than 90 days old.", allowanceBps: 150 },
  declining_trend: { code: "declining_trend", severity: "medium", title: "Prices trending down", detail: "Recent sold prices show a downward trend.", allowanceBps: 300 },
  weak_demand: { code: "weak_demand", severity: "high", title: "Weak demand", detail: "Sold-to-active ratio is below 30%.", allowanceBps: 300 },
  price_too_good: { code: "price_too_good", severity: "high", title: "Price far below market", detail: "Asking price is under 35% of conservative value. Could be a hidden gem, a misidentification, or a scam.", allowanceBps: 0 },
  fragile_shipping: { code: "fragile_shipping", severity: "low", title: "Fragile or oversized shipping", detail: "Higher damage and shipping-cost risk.", allowanceBps: 200 },
  provisional_location: { code: "provisional_location", severity: "low", title: "Approximate pickup location", detail: "Drive time is provisional until the exact pickup point is known.", allowanceBps: 0 },
};

export function makeRisk(code: keyof typeof RISK_CATALOG | string, detail?: string, resolved = false): RiskFactor {
  const base = RISK_CATALOG[code];
  if (!base) return { code, severity: "medium", title: code, detail: detail ?? "", allowanceBps: 0, resolved };
  return { ...base, detail: detail ?? base.detail, resolved };
}

export interface CategoryRiskProfile {
  /** Baseline allowance (bps of sale value) for the category's inherent risk. */
  baseAllowanceBps: Bps;
  authenticationRequired: boolean;
  electronics: boolean;
  fragile: boolean;
}

export const CATEGORY_RISK: Record<string, CategoryRiskProfile> = {
  video_games: { baseAllowanceBps: 300, authenticationRequired: false, electronics: false, fragile: false },
  game_consoles: { baseAllowanceBps: 400, authenticationRequired: false, electronics: true, fragile: false },
  electronics: { baseAllowanceBps: 500, authenticationRequired: false, electronics: true, fragile: true },
  computers: { baseAllowanceBps: 500, authenticationRequired: false, electronics: true, fragile: true },
  phones_tablets: { baseAllowanceBps: 500, authenticationRequired: false, electronics: true, fragile: true },
  dj_equipment: { baseAllowanceBps: 400, authenticationRequired: false, electronics: true, fragile: true },
  audio_vintage: { baseAllowanceBps: 600, authenticationRequired: false, electronics: true, fragile: true },
  cameras: { baseAllowanceBps: 500, authenticationRequired: false, electronics: true, fragile: true },
  sports_cards: { baseAllowanceBps: 300, authenticationRequired: true, electronics: false, fragile: false },
  trading_cards: { baseAllowanceBps: 300, authenticationRequired: true, electronics: false, fragile: false },
  toys_vintage: { baseAllowanceBps: 400, authenticationRequired: false, electronics: false, fragile: false },
  dolls: { baseAllowanceBps: 400, authenticationRequired: true, electronics: false, fragile: false },
  lego: { baseAllowanceBps: 300, authenticationRequired: false, electronics: false, fragile: false },
  artwork: { baseAllowanceBps: 800, authenticationRequired: true, electronics: false, fragile: true },
  watches: { baseAllowanceBps: 600, authenticationRequired: true, electronics: false, fragile: false },
  jewelry: { baseAllowanceBps: 700, authenticationRequired: true, electronics: false, fragile: false },
  handbags: { baseAllowanceBps: 700, authenticationRequired: true, electronics: false, fragile: false },
  autographs: { baseAllowanceBps: 800, authenticationRequired: true, electronics: false, fragile: false },
  coins: { baseAllowanceBps: 400, authenticationRequired: true, electronics: false, fragile: false },
  glassware_pottery: { baseAllowanceBps: 600, authenticationRequired: false, electronics: false, fragile: true },
  furniture: { baseAllowanceBps: 600, authenticationRequired: false, electronics: false, fragile: true },
  musical_instruments: { baseAllowanceBps: 500, authenticationRequired: false, electronics: false, fragile: true },
  other: { baseAllowanceBps: 500, authenticationRequired: false, electronics: false, fragile: false },
};

export function categoryRisk(category: string | null | undefined): CategoryRiskProfile {
  return CATEGORY_RISK[category ?? "other"] ?? CATEGORY_RISK.other!;
}

export function riskAllowanceCents(saleValueCents: Cents, category: string | null, factors: readonly RiskFactor[]): Cents {
  const base = categoryRisk(category).baseAllowanceBps;
  const extra = factors.filter((f) => !f.resolved).reduce((a, f) => a + f.allowanceBps, 0);
  return applyBps(saleValueCents, base + extra);
}

export function unresolvedCritical(factors: readonly RiskFactor[]): RiskFactor[] {
  return factors.filter((f) => f.severity === "critical" && !f.resolved);
}
