/**
 * End-to-end business workflow through the service layer on a real Postgres schema.
 * All values are synthetic TEST FIXTURES, not market data.
 */
import { describe, expect, it } from "vitest";
import { withOwner, LOCAL_OWNER_ID as OWNER } from "@/server/db";
import { DEFAULT_SETTINGS } from "@/domain/settings";
import { getBuyingPower, getSettings, saveSettings } from "@/server/services/core";
import { getOpportunityDetail, importListing, listFeed } from "@/server/services/opportunities";
import { addComparable, recordLiquidity, recordRoute, updateFacts } from "@/server/services/research";
import { getNegotiation, markAgreed, markMessageSent, recordSellerReply, startNegotiation } from "@/server/services/negotiation";
import { listInventory, markPurchased, recordReturn, recordSale, upsertSaleListing } from "@/server/services/inventory";

const run = <T>(fn: Parameters<typeof withOwner<T>>[1]) => withOwner(OWNER, fn);

describe("resale workflow", () => {
  let oppId = "";

  it("completes onboarding with a $1,000 opening bankroll exactly once", async () => {
    await run((q) => saveSettings(q, OWNER, DEFAULT_SETTINGS, true));
    await run((q) => saveSettings(q, OWNER, DEFAULT_SETTINGS, true));
    const bp = await run(async (q) => getBuyingPower(q, OWNER, (await getSettings(q, OWNER)).settings));
    expect(bp.summary.cashCents).toBe(100_000);
    expect(bp.summary.revenueCents).toBe(0);
    expect(bp.availableCents).toBe(80_000);
  });

  it("imports a listing URL and dedupes a repeat import", async () => {
    const res = await run((q) =>
      importListing(q, OWNER, { url: "https://www.facebook.com/marketplace/item/111222333444/?ref=share", title: "PS5 Disc Console Bundle", askingPriceCents: 25_000, category: "game_consoles", importMethod: "url", locationText: "Romeoville, IL", locationPrecision: "approximate" }),
    );
    oppId = res.opportunityId;
    const again = await run((q) =>
      importListing(q, OWNER, { url: "https://m.facebook.com/marketplace/item/111222333444/", title: "PS5 Disc Console Bundle", askingPriceCents: 24_000, category: "game_consoles", importMethod: "url" }),
    );
    expect(again.duplicateOf).toBe(oppId);
    const d = await run((q) => getOpportunityDetail(q, OWNER, oppId));
    expect(d!.opportunity.asking_price_cents).toBe(24_000);
    expect(d!.priceHistory.map((p) => p.price_cents)).toEqual([25_000, 24_000]);
    expect(d!.evaluation!.decision).toBe("RESEARCH_REQUIRED");
  });

  it("shows missing sold data honestly, then values the item from sold comps", async () => {
    await run((q) => addComparable(q, OWNER, oppId, { productIdentity: "PS5 Disc", source: "eBay active", evidenceType: "active_listing", priceCents: 50_000, matchConfidence: 0.9, variantMatch: true, conditionMatch: "exact" }));
    let d = await run((q) => getOpportunityDetail(q, OWNER, oppId));
    expect(d!.evaluation!.valuation.status).toBe("insufficient");

    const today = new Date();
    for (const [i, price] of [36_000, 37_000, 37_500, 38_000, 38_500, 39_000].entries()) {
      const date = new Date(today.getTime() - (5 + i * 4) * 86_400_000).toISOString().slice(0, 10);
      await run((q) => addComparable(q, OWNER, oppId, { productIdentity: "PS5 Disc CFI-1215A bundle", source: "eBay sold (Terapeak)", sourceUrl: `https://www.ebay.com/itm/90000000${i}`, saleDate: date, priceCents: price, shippingCents: 0, evidenceType: "sold_user_recorded", matchConfidence: 0.9, variantMatch: true, conditionMatch: "exact" }));
    }
    await run((q) => recordLiquidity(q, OWNER, oppId, { soldCount90d: 120, activeCount: 80, source: "eBay Terapeak" }));
    await run((q) => updateFacts(q, OWNER, oppId, { identityStatus: "verified", identityConfidence: 0.95, conditionConfidence: 0.8, functionalityTested: true, shippingLabelCents: 2_500, authenticityStatus: "not_required" }));
    await run((q) => recordRoute(q, OWNER, oppId, { source: "manual", precision: "approximate", oneWayMinutes: 14, oneWayMiles: 8 }));
    d = await run((q) => getOpportunityDetail(q, OWNER, oppId));
    const ev = d!.evaluation!;
    expect(ev.valuation.sampleSize).toBe(6);
    expect(ev.valuation.usedCompIds.length).toBe(6);
    expect(ev.liquidity.classification).toBe("highly_liquid");
    expect(ev.travel.status).toBe("provisional");
    expect(ev.maxPurchasePriceCents).not.toBeNull();
    expect(["STRONG_BUY", "BUY_IF_NEGOTIATED"]).toContain(ev.decision);
    const feed = await run((q) => listFeed(q, OWNER, { decision: "ACTIONABLE" }));
    expect(feed.map((f) => f.id)).toContain(oppId);
  });

  it("negotiates without ever exceeding the maximum", async () => {
    await run((q) => startNegotiation(q, OWNER, oppId));
    let n = await run((q) => getNegotiation(q, OWNER, oppId));
    const draft = n!.messages.find((m) => m.status === "draft")!;
    expect(draft.body).toMatch(/\$\d/);
    await run((q) => markMessageSent(q, OWNER, draft.id, n!.opening_offer_cents));
    const counter = await run((q) => recordSellerReply(q, OWNER, oppId, "Could do a bit more than that", n!.max_price_cents! + 2_000));
    expect(counter!.decision).toBe("walk_away");
    await expect(run((q) => markAgreed(q, OWNER, oppId, n!.max_price_cents! + 1, null, null))).rejects.toThrow(/exceeds/);
    await run((q) => markAgreed(q, OWNER, oppId, n!.target_price_cents!, new Date(Date.now() + 86_400_000).toISOString(), "Lockport police station"));
    n = await run((q) => getNegotiation(q, OWNER, oppId));
    expect(n!.status).toBe("agreed");
  });

  let itemId = "";
  it("records the purchase as inventory, moving cash to inventory", async () => {
    const n = await run((q) => getNegotiation(q, OWNER, oppId));
    itemId = await run((q) => markPurchased(q, OWNER, oppId, { pricePaidCents: n!.agreed_price_cents!, travelCostCents: 1_300, purchaseDate: new Date().toISOString().slice(0, 10), inspectionChecklist: { powers_on: true, hdmi: true } }));
    const bp = await run(async (q) => getBuyingPower(q, OWNER, (await getSettings(q, OWNER)).settings));
    expect(bp.summary.inventoryCostCents).toBe(n!.agreed_price_cents);
    expect(bp.summary.cashCents).toBe(100_000 - n!.agreed_price_cents! - 1_300);
    expect(bp.summary.netOperatingProfitCents).toBe(-1_300);
    const inv = await run((q) => listInventory(q, OWNER));
    expect(inv[0]!.status).toBe("ready_to_list");
  });

  it("lists, sells, and reports realized profit; rejects a duplicate order", async () => {
    await run((q) => upsertSaleListing(q, OWNER, itemId, { channel: "ebay_us", title: "Sony PS5 Disc Console Bundle CFI-1215A Tested", priceCents: 38_900, status: "active" }));
    const sale = await run((q) => recordSale(q, OWNER, itemId, { channel: "ebay_us", externalOrderId: "12-34567-89012", soldDate: new Date().toISOString().slice(0, 10), itemPriceCents: 37_500, taxCollectedCents: 3_000, labelCostCents: 2_300, suppliesCents: 200 }));
    expect(sale.feesEstimated).toBe(true);
    await expect(run((q) => recordSale(q, OWNER, itemId, { channel: "ebay_us", externalOrderId: "12-34567-89012", soldDate: "2026-10-13", itemPriceCents: 37_500 }))).rejects.toThrow();
    const bp = await run(async (q) => getBuyingPower(q, OWNER, (await getSettings(q, OWNER)).settings));
    expect(bp.summary.inventoryCostCents).toBe(0);
    expect(bp.summary.netOperatingProfitCents).toBe(sale.profitCents - 1_300);
    expect(bp.summary.equityCents).toBe(bp.summary.cashCents);
    const d = await run((q) => getOpportunityDetail(q, OWNER, oppId));
    expect(d!.opportunity.status).toBe("sold");
  });

  it("handles a partial refund in the ledger", async () => {
    const before = await run(async (q) => getBuyingPower(q, OWNER, (await getSettings(q, OWNER)).settings));
    await run((q) => recordReturn(q, OWNER, itemId, { refundCents: 2_000, feeCreditCents: 250, restocked: false, reason: "Scuffed controller" }));
    const after = await run(async (q) => getBuyingPower(q, OWNER, (await getSettings(q, OWNER)).settings));
    expect(after.summary.netOperatingProfitCents).toBe(before.summary.netOperatingProfitCents - 1_750);
  });
});
