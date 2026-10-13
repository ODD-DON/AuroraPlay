import { describe, expect, it } from "vitest";
import { calculateSaleFees, EBAY_US_FEES, LOCAL_CASH_FEES, tieredFee } from "@/domain/fees";
import { applyBps, dollarsToCents, formatCents, roundOfferDown } from "@/domain/money";
import {
  breakEvenPurchasePrice,
  breakEvenSalePrice,
  calculateProfit,
  defaultSale,
  maxAcceptablePurchasePrice,
  runScenarios,
  ZERO_ACQUISITION,
  type ProfitInput,
} from "@/domain/profit";

const ebayInput = (overrides: Partial<ProfitInput> = {}): ProfitInput => ({
  acquisition: { ...ZERO_ACQUISITION, purchasePriceCents: 10_000 },
  sale: defaultSale(EBAY_US_FEES, {
    itemPriceCents: 20_000,
    buyerSalesTaxBps: 800,
    shippingLabelCents: 1_200,
    packagingCents: 150,
    returnsAllowanceBps: 200,
    damageRiskBps: 100,
    holdingDays: 14,
  }),
  travelCostCents: 0,
  riskAllowanceCents: 0,
  sourcingMinutes: 30,
  handlingMinutes: 30,
  ...overrides,
});

describe("money", () => {
  it("parses and formats dollars without float drift", () => {
    expect(dollarsToCents("$1,234.56")).toBe(123_456);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
    expect(formatCents(-1_050)).toBe("-$10.50");
    expect(applyBps(1_000, 1_360)).toBe(136);
  });
  it("rounds offers to human increments", () => {
    expect(roundOfferDown(19_740)).toBe(19_500);
    expect(roundOfferDown(43_999)).toBe(43_000);
    expect(roundOfferDown(250_000)).toBe(250_000);
  });
});

describe("eBay fees", () => {
  it("charges the final value fee on item + shipping + sales tax plus the per-order fee", () => {
    const f = calculateSaleFees(EBAY_US_FEES, { itemPriceCents: 10_000, shippingChargedCents: 0, buyerSalesTaxBps: 800 });
    expect(f.salesTaxCents).toBe(800);
    expect(f.feeBasisCents).toBe(10_800);
    expect(f.finalValueFeeCents).toBe(1_469); // 13.6% of $108.00 = $14.688
    expect(f.perOrderFeeCents).toBe(40);
    expect(f.totalFeesCents).toBe(1_509);
  });

  it("includes buyer-paid shipping in the basis", () => {
    const f = calculateSaleFees(EBAY_US_FEES, { itemPriceCents: 10_000, shippingChargedCents: 1_000, buyerSalesTaxBps: 0 });
    expect(f.feeBasisCents).toBe(11_000);
    expect(f.finalValueFeeCents).toBe(1_496);
  });

  it("applies tiers marginally above $7,500", () => {
    expect(tieredFee(800_000, EBAY_US_FEES.categories[0]!.tiers)).toBe(103_175);
  });

  it("uses the lower per-order fee at or below $10", () => {
    const f = calculateSaleFees(EBAY_US_FEES, { itemPriceCents: 900, shippingChargedCents: 0, buyerSalesTaxBps: 0 });
    expect(f.perOrderFeeCents).toBe(30);
    const g = calculateSaleFees(EBAY_US_FEES, { itemPriceCents: 1_001, shippingChargedCents: 0, buyerSalesTaxBps: 0 });
    expect(g.perOrderFeeCents).toBe(40);
  });

  it("uses category-specific tiers", () => {
    const f = calculateSaleFees(EBAY_US_FEES, { itemPriceCents: 200_000, shippingChargedCents: 0, buyerSalesTaxBps: 0, categoryId: "watches" });
    expect(f.finalValueFeeCents).toBe(21_500); // 15% of $1,000 + 6.5% of $1,000
    const c = calculateSaleFees(EBAY_US_FEES, { itemPriceCents: 10_000, shippingChargedCents: 0, buyerSalesTaxBps: 0, categoryId: "trading_cards" });
    expect(c.finalValueFeeCents).toBe(1_325);
  });

  it("applies seller adjustments to the right bases", () => {
    const f = calculateSaleFees(
      EBAY_US_FEES,
      { itemPriceCents: 10_000, shippingChargedCents: 0, buyerSalesTaxBps: 800 },
      { topRatedDiscountBps: 1_000, belowStandardSurchargeBps: 0, promotedRateBps: 500, internationalFeeBps: 0 },
    );
    expect(f.topRatedDiscountCents).toBe(147);
    expect(f.finalValueFeeCents).toBe(1_322);
    expect(f.promotedFeeCents).toBe(500); // ad rate excludes sales tax
  });

  it("local cash sales have no fees", () => {
    expect(calculateSaleFees(LOCAL_CASH_FEES, { itemPriceCents: 50_000, shippingChargedCents: 0, buyerSalesTaxBps: 800 }).totalFeesCents).toBe(0);
  });
});

describe("profit engine", () => {
  it("computes net profit and cash ROI with consistent definitions", () => {
    const r = calculateProfit(ebayInput());
    expect(r.fees.totalFeesCents).toBe(2_978);
    expect(r.netProceedsCents).toBe(20_000 - 2_978 - 1_350);
    expect(r.returnsAllowanceCents).toBe(400);
    expect(r.damageAllowanceCents).toBe(200);
    expect(r.cashInvestedCents).toBe(10_000);
    expect(r.netProfitCents).toBe(5_072);
    expect(r.cashRoiBps).toBe(5_072);
    expect(r.profitPerHourCents).toBe(5_072);
  });

  it("includes purchase tax, inbound shipping, prep, and travel in cash invested", () => {
    const r = calculateProfit(
      ebayInput({
        acquisition: { ...ZERO_ACQUISITION, purchasePriceCents: 10_000, purchaseTaxBps: 1_000, inboundShippingCents: 500, repairCents: 300 },
        travelCostCents: 700,
      }),
    );
    expect(r.acquisitionCashCents).toBe(11_500);
    expect(r.cashInvestedCents).toBe(12_500);
    expect(r.netProfitCents).toBe(5_072 - 2_500);
  });

  it("finds the break-even sale price exactly", () => {
    const input = ebayInput();
    const be = breakEvenSalePrice(input);
    expect(calculateProfit({ ...input, sale: { ...input.sale, itemPriceCents: be } }).netProfitCents).toBeGreaterThanOrEqual(0);
    expect(calculateProfit({ ...input, sale: { ...input.sale, itemPriceCents: be - 1 } }).netProfitCents).toBeLessThan(0);
  });

  it("finds break-even and maximum purchase prices", () => {
    const input = ebayInput();
    expect(breakEvenPurchasePrice(input)).toBe(15_072);
    // Profit floor binds: 15072 - P >= 6000 -> P <= 9072. ROI floor allows up to 12057.
    expect(maxAcceptablePurchasePrice(input, { minNetProfitCents: 6_000, minCashRoiBps: 2_500 })).toBe(9_072);
    // ROI floor binds when the profit floor is low.
    expect(maxAcceptablePurchasePrice(input, { minNetProfitCents: 100, minCashRoiBps: 5_000 })).toBe(10_048);
  });

  it("returns null when no price meets the constraints", () => {
    expect(maxAcceptablePurchasePrice(ebayInput(), { minNetProfitCents: 50_000, minCashRoiBps: 0 })).toBeNull();
  });

  it("runs conservative, base, and optimistic scenarios", () => {
    const res = runScenarios(ebayInput(), {
      conservative: { itemPriceCents: 18_000, holdingDays: 30, sellingCostMultiplierBps: 11_500, returnsMultiplierBps: 15_000 },
      base: { itemPriceCents: 20_000, holdingDays: 14, sellingCostMultiplierBps: 10_000, returnsMultiplierBps: 10_000 },
      optimistic: { itemPriceCents: 22_000, holdingDays: 7, sellingCostMultiplierBps: 10_000, returnsMultiplierBps: 10_000 },
    });
    const [c, b, o] = res.map((s) => s.result.netProfitCents);
    expect(b).toBe(5_072);
    expect(c!).toBeLessThan(b!);
    expect(o!).toBeGreaterThan(b!);
    expect(res[0]!.result.returnsAllowanceCents).toBe(540); // 3% of $180
  });
});
