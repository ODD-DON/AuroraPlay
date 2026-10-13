import { describe, expect, it } from "vitest";
import { valueFromComparables } from "@/domain/valuation";
import { estimateLiquidity } from "@/domain/liquidity";
import { evaluateOpportunity } from "@/domain/evaluate";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import { buildOfferLadder, evaluateCounteroffer, draftOpeningMessage } from "@/domain/negotiation";
import { allocateCapital } from "@/domain/capital";
import { assessDuplicate, canonicalizeUrl } from "@/domain/dedup";
import { baseInput, NOW, soldComps } from "../fixtures/opportunity";

describe("valuation", () => {
  it("uses only sold transactions and computes robust statistics", () => {
    const comps = [
      ...soldComps([100, 110, 120, 130, 140, 150, 160, 170]),
      { id: "ask", evidenceType: "active_listing" as const, totalPriceCents: 50_000, saleDate: null, matchConfidence: 1, variantMatch: true, conditionMatch: "exact" as const },
    ];
    const v = valueFromComparables(comps, NOW);
    expect(v.status).toBe("valued");
    expect(v.sampleSize).toBe(8);
    expect(v.evidenceStrength).toBe("strong");
    expect(v.medianCents).toBe(13_500);
    expect(v.p25Cents).toBe(11_750);
    expect(v.conservativeCents).toBe(11_750);
    expect(v.usedCompIds).not.toContain("ask");
    expect(v.contextOnly.find((c) => c.type === "active_listing")?.count).toBe(1);
  });

  it("rejects outliers, wrong variants, better-condition, low-confidence, and stale comps", () => {
    const comps = soldComps([100, 105, 110, 115, 1000]);
    comps.push({ ...comps[0]!, id: "variant", variantMatch: false });
    comps.push({ ...comps[0]!, id: "better", conditionMatch: "better" });
    comps.push({ ...comps[0]!, id: "lowconf", matchConfidence: 0.3 });
    comps.push({ ...comps[0]!, id: "stale", saleDate: "2025-01-01T00:00:00Z" });
    const v = valueFromComparables(comps, NOW);
    expect(v.sampleSize).toBe(4);
    expect(v.excluded.map((e) => e.id).sort()).toEqual(["better", "fixture-comp-4", "lowconf", "stale", "variant"]);
  });

  it("never substitutes active listings when no sales exist", () => {
    const v = valueFromComparables(
      [{ id: "a", evidenceType: "active_listing", totalPriceCents: 30_000, saleDate: null, matchConfidence: 1, variantMatch: true, conditionMatch: "exact" }],
      NOW,
    );
    expect(v.status).toBe("insufficient");
    expect(v.conservativeCents).toBeNull();
  });

  it("widens the range for thin evidence", () => {
    const v = valueFromComparables(soldComps([200, 260]), NOW);
    expect(v.evidenceStrength).toBe("thin");
    expect(v.conservativeCents).toBe(20_000);
  });
});

describe("liquidity", () => {
  it("classifies demand and estimates time to sale from days of inventory", () => {
    const l = estimateLiquidity({ soldCount90d: 30, activeCount: 20, rareItem: false });
    expect(l.soldToActiveRatioBps).toBe(15_000);
    expect(l.classification).toBe("highly_liquid");
    expect([l.daysToSellLow, l.daysToSellBase, l.daysToSellHigh]).toEqual([15, 30, 60]);
  });
  it("returns unknown rather than inventing numbers", () => {
    const l = estimateLiquidity({ soldCount90d: null, activeCount: 10, rareItem: false });
    expect(l.classification).toBe("unknown");
    expect(l.daysToSellBase).toBeNull();
  });
  it("does not treat rare items as liquid", () => {
    expect(estimateLiquidity({ soldCount90d: 2, activeCount: 1, rareItem: true }).classification).toBe("speculative");
  });
});

describe("deal classification", () => {
  it("issues a strong buy for a verified local deal", () => {
    const e = evaluateOpportunity(baseInput(), DEFAULT_SETTINGS, NOW);
    expect(e.decision).toBe("STRONG_BUY");
    expect(e.hardFilters.every((f) => f.passed)).toBe(true);
    expect(e.maxPurchasePriceCents).toBeGreaterThan(15_000);
  });

  const doll = () =>
    baseInput({
      askingPriceCents: 4_000,
      category: "dolls",
      authenticity: "verified",
      comps: soldComps([420, 440, 455, 470, 480, 500, 520]),
      liquidity: { soldCount90d: 8, activeCount: 10, rareItem: false },
      route: { source: "google_routes", precision: "exact", trafficAware: true, oneWayMinutes: 42, oneWayMiles: 30, tollsCents: 0, parkingCents: 0, computedAt: NOW.toISOString() },
      shippingLabelCents: 1_500,
    });

  it("flags a verified collectible 42 minutes away as Worth the Drive", () => {
    const e = evaluateOpportunity(doll(), DEFAULT_SETTINGS, NOW);
    expect(e.travelQualification.tier?.id).toBe("regional");
    expect(e.decision).toBe("WORTH_THE_DRIVE");
    const conservative = e.scenariosAtAsking!.find((s) => s.name === "conservative")!.result;
    expect(conservative.netProfitCents).toBeGreaterThanOrEqual(17_500);
    expect(conservative.travelCostCents).toBeGreaterThan(0);
  });

  it("never recommends the drive on speculative AI identification alone", () => {
    const e = evaluateOpportunity(
      { ...doll(), identity: { status: "probable", confidence: 0.6 }, authenticity: "unverified", comps: [], hiddenGem: { flagged: true, potentialHighCents: 50_000, rationale: "Looks like an early vintage doll." } },
      DEFAULT_SETTINGS,
      NOW,
    );
    expect(e.decision).toBe("HIDDEN_GEM");
    expect(e.maxPurchasePriceCents).toBeNull();
  });

  it("does not let an unauthenticated collectible qualify", () => {
    const e = evaluateOpportunity({ ...doll(), authenticity: "unverified" }, DEFAULT_SETTINGS, NOW);
    expect(e.decision).toBe("RESEARCH_REQUIRED");
  });

  it("requires a higher profit for longer drives", () => {
    const thin = { ...doll(), askingPriceCents: 22_000 };
    const local = evaluateOpportunity({ ...thin, route: { ...thin.route, oneWayMinutes: 15, oneWayMiles: 9 } }, DEFAULT_SETTINGS, NOW);
    const far = evaluateOpportunity(thin, DEFAULT_SETTINGS, NOW);
    expect(local.decision).toBe("STRONG_BUY");
    expect(["BUY_IF_NEGOTIATED", "PASS"]).toContain(far.decision);
    expect(far.maxPurchasePriceCents!).toBeLessThan(local.maxPurchasePriceCents!);
  });

  it("passes on trips beyond the maximum travel range", () => {
    const d = doll();
    const e = evaluateOpportunity({ ...d, route: { ...d.route, oneWayMinutes: 95, oneWayMiles: 80 } }, DEFAULT_SETTINGS, NOW);
    expect(e.decision).toBe("PASS");
  });

  it("requires manual review for exceptional deals over 60 minutes", () => {
    const d = doll();
    const e = evaluateOpportunity(
      { ...d, comps: soldComps([900, 950, 980, 1000, 1020, 1050]), route: { ...d.route, oneWayMinutes: 70, oneWayMiles: 55 } },
      DEFAULT_SETTINGS,
      NOW,
    );
    expect(e.decision).toBe("WORTH_THE_DRIVE");
    expect(e.requiresManualReview).toBe(true);
  });

  it("ranks a $300 deal 40 minutes away above a $65 deal 5 minutes away", () => {
    const near = evaluateOpportunity(
      baseInput({ askingPriceCents: 18_000, route: { ...baseInput().route, oneWayMinutes: 5, oneWayMiles: 3 } }),
      DEFAULT_SETTINGS,
      NOW,
    );
    const far = evaluateOpportunity(
      baseInput({ askingPriceCents: 15_000, comps: soldComps([620, 640, 650, 660, 670, 680, 690, 700]), route: { ...baseInput().route, oneWayMinutes: 40, oneWayMiles: 28 } }),
      DEFAULT_SETTINGS,
      NOW,
    );
    const nearNet = near.scenariosAtAsking!.find((s) => s.name === "conservative")!.result.netProfitCents;
    const farNet = far.scenariosAtAsking!.find((s) => s.name === "conservative")!.result.netProfitCents;
    expect(nearNet).toBeGreaterThanOrEqual(6_000);
    expect(farNet).toBeGreaterThanOrEqual(25_000);
    expect(far.decision).toBe("WORTH_THE_DRIVE");
    expect(far.score).toBeGreaterThan(near.score);
  });

  it("marks unavailable listings and fraud indicators", () => {
    expect(evaluateOpportunity(baseInput({ listingAvailable: false }), DEFAULT_SETTINGS, NOW).decision).toBe("UNAVAILABLE");
    const e = evaluateOpportunity(
      baseInput({ manualRiskFactors: [{ code: "suspicious_payment", severity: "critical", title: "Unusual payment request", detail: "Wants a deposit", allowanceBps: 0, resolved: false }] }),
      DEFAULT_SETTINGS,
      NOW,
    );
    expect(e.decision).toBe("PASS");
  });

  it("asks for research when drive time is unknown", () => {
    const e = evaluateOpportunity(baseInput({ route: { source: "unknown", precision: "unknown", trafficAware: false, oneWayMinutes: null, oneWayMiles: null, tollsCents: 0, parkingCents: 0, computedAt: null } }), DEFAULT_SETTINGS, NOW);
    expect(e.decision).toBe("RESEARCH_REQUIRED");
  });

  it("suggests negotiation when the deal works below asking", () => {
    const e = evaluateOpportunity(baseInput({ askingPriceCents: 25_000 }), DEFAULT_SETTINGS, NOW);
    expect(e.decision).toBe("BUY_IF_NEGOTIATED");
    expect(e.offers!.maxPriceCents).toBe(e.maxPurchasePriceCents);
    expect(e.offers!.openingOfferCents).toBeLessThanOrEqual(e.offers!.targetPriceCents);
    expect(e.offers!.targetPriceCents).toBeLessThanOrEqual(e.offers!.maxPriceCents);
  });
});

describe("negotiation", () => {
  const ladder = buildOfferLadder(25_000, 20_000, 3_500)!;
  it("never offers above the maximum", () => {
    expect(ladder.openingOfferCents).toBeLessThanOrEqual(ladder.maxPriceCents);
    expect(ladder.targetPriceCents).toBeLessThanOrEqual(ladder.maxPriceCents);
  });
  it("evaluates counteroffers against the ceiling", () => {
    expect(evaluateCounteroffer(18_000, ladder, 17_000).decision).toBe("accept");
    const mid = evaluateCounteroffer(19_800, ladder, 17_000);
    expect(mid.decision).toBe("counter");
    expect(mid.suggestedCounterCents!).toBeLessThanOrEqual(20_000);
    expect(evaluateCounteroffer(22_000, ladder, 17_000).decision).toBe("walk_away");
  });
  it("drafts natural messages with the offer", () => {
    const msg = draftOpeningMessage({ seed: "x1", itemShortName: "PS5", offerCents: 18_000, canPickUpToday: true });
    expect(msg).toContain("$180.00");
    expect(msg).not.toMatch(/\s{2}/);
  });
});

describe("capital allocation", () => {
  it("picks the most profitable combination within buying power and exposure caps", () => {
    const r = allocateCapital(
      [
        { id: "a", label: "a", cashRequiredCents: 50_000, conservativeNetCents: 12_000, expectedDaysToCash: 20, speculative: false, category: null },
        { id: "b", label: "b", cashRequiredCents: 30_000, conservativeNetCents: 9_000, expectedDaysToCash: 10, speculative: false, category: null },
        { id: "c", label: "c", cashRequiredCents: 30_000, conservativeNetCents: 8_000, expectedDaysToCash: 10, speculative: false, category: null },
        { id: "d", label: "d", cashRequiredCents: 20_000, conservativeNetCents: 9_000, expectedDaysToCash: 60, speculative: true, category: null },
      ],
      { buyingPowerCents: 60_000, equityCents: 100_000, maxSingleItemExposureBps: 4_000, maxSpeculativeExposureBps: 1_500, existingSpeculativeCents: 0 },
    );
    expect(r.selectedIds.sort()).toEqual(["b", "c"]);
    expect(r.excluded.find((x) => x.id === "a")?.reason).toMatch(/single-item/);
    expect(r.excluded.find((x) => x.id === "d")?.reason).toMatch(/speculative/);
  });
});

describe("deduplication", () => {
  it("canonicalizes marketplace URLs", () => {
    expect(canonicalizeUrl("https://m.facebook.com/marketplace/item/123456789012/?ref=share&mibextid=abc")).toEqual({
      source: "facebook_marketplace",
      externalId: "123456789012",
      canonicalUrl: "https://www.facebook.com/marketplace/item/123456789012/",
    });
    expect(canonicalizeUrl("https://www.ebay.com/itm/PS5-Console/2345678901234?hash=x")?.externalId).toBe("2345678901234");
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
  });
  const base = { id: "1", source: "facebook_marketplace", externalId: "1", canonicalUrl: null, title: "PS5 Disc Edition with 2 controllers", priceCents: 35_000, sellerName: "Jane", imageHashes: ["ffff0000ffff0000"] };
  it("links relists using multiple signals", () => {
    const r = assessDuplicate(base, { ...base, id: "2", externalId: "2", title: "PS5 disc edition w/ 2 controllers", priceCents: 33_000 });
    expect(r.isDuplicate).toBe(true);
  });
  it("never merges on image similarity alone", () => {
    const r = assessDuplicate(base, { ...base, id: "3", externalId: "3", title: "Vintage lamp", priceCents: 4_000, sellerName: "Bob" });
    expect(r.isDuplicate).toBe(false);
  });
});
