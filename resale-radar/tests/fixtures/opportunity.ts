/**
 * TEST FIXTURES ONLY. These values are synthetic and are not market data.
 */
import type { OpportunityInput } from "@/domain/evaluate";
import type { Comparable } from "@/domain/valuation";

export const NOW = new Date("2026-10-13T12:00:00Z");

export function soldComps(pricesDollars: number[], daysAgo = 20): Comparable[] {
  return pricesDollars.map((p, i) => ({
    id: `fixture-comp-${i}`,
    evidenceType: "sold_verified",
    totalPriceCents: Math.round(p * 100),
    // Newer sales are listed last so price order does not imply a falling trend.
    saleDate: new Date(NOW.getTime() - (daysAgo + (pricesDollars.length - 1 - i)) * 86_400_000).toISOString(),
    matchConfidence: 0.9,
    variantMatch: true,
    conditionMatch: "exact",
  }));
}

export function baseInput(overrides: Partial<OpportunityInput> = {}): OpportunityInput {
  return {
    askingPriceCents: 15_000,
    category: "video_games",
    listingAvailable: true,
    identity: { status: "verified", confidence: 0.95 },
    authenticity: "not_required",
    conditionConfidence: 0.8,
    functionalityTested: true,
    comps: soldComps([340, 350, 355, 360, 365, 370, 375, 380]),
    liquidity: { soldCount90d: 40, activeCount: 25, rareItem: false },
    route: { source: "manual", precision: "exact", trafficAware: false, oneWayMinutes: 12, oneWayMiles: 7, tollsCents: 0, parkingCents: 0, computedAt: NOW.toISOString() },
    shippingLabelCents: 1_400,
    buyingPowerCents: 80_000,
    ...overrides,
  };
}
