import { calculateSaleFees, type MarketplaceFeeSchedule, type SaleFeeBreakdown, type SellerFeeAdjustments, NO_ADJUSTMENTS } from "./fees";
import { applyBps, ratioBps, roundHalfAway, type Bps, type Cents } from "./money";

/**
 * Deterministic profitability engine. AI never performs these calculations.
 *
 * Definitions (used consistently everywhere):
 *  - Cash invested = purchase price + purchase tax + buyer fees + inbound shipping
 *    + preparation costs (inspection, testing, repairs, accessories) + allocated travel.
 *  - Net operating profit = buyer subtotal - marketplace fees - selling costs
 *    - returns and damage allowances - cash invested - risk allowance.
 *    Sales tax collected by the marketplace is excluded from revenue because the
 *    seller never receives it (it only enlarges the fee basis).
 *  - Cash ROI = net operating profit / cash invested.
 *  - The owner's time value is never included in operating profit; it is reported
 *    separately as profit per hour.
 */

export interface AcquisitionCosts {
  purchasePriceCents: Cents;
  purchaseTaxBps: Bps;
  buyerFeesCents: Cents;
  inboundShippingCents: Cents;
  inspectionCents: Cents;
  testingCents: Cents;
  repairCents: Cents;
  accessoriesCents: Cents;
}

export interface SaleAssumptions {
  schedule: MarketplaceFeeSchedule;
  categoryId: string | null;
  adjustments: SellerFeeAdjustments;
  /** Price the buyer pays for the item, excluding shipping and tax. */
  itemPriceCents: Cents;
  shippingChargedCents: Cents;
  buyerSalesTaxBps: Bps;
  shippingLabelCents: Cents;
  insuranceCents: Cents;
  signatureCents: Cents;
  packagingCents: Cents;
  otherSellingCents: Cents;
  returnsAllowanceBps: Bps;
  damageRiskBps: Bps;
  holdingDays: number | null;
}

export interface ProfitInput {
  acquisition: AcquisitionCosts;
  sale: SaleAssumptions;
  travelCostCents: Cents;
  riskAllowanceCents: Cents;
  /** Drive plus pickup minutes. */
  sourcingMinutes: number | null;
  /** Listing, packing, and shipping minutes. */
  handlingMinutes: number;
}

export interface ProfitResult {
  buyerSubtotalCents: Cents;
  fees: SaleFeeBreakdown;
  sellingCostsCents: Cents;
  returnsAllowanceCents: Cents;
  damageAllowanceCents: Cents;
  acquisitionCashCents: Cents;
  preparationCostsCents: Cents;
  travelCostCents: Cents;
  cashInvestedCents: Cents;
  riskAllowanceCents: Cents;
  netProceedsCents: Cents;
  grossProfitCents: Cents;
  netProfitCents: Cents;
  cashRoiBps: Bps | null;
  grossMarginBps: Bps | null;
  netMarginBps: Bps | null;
  profitPerHourCents: Cents | null;
  /** Net profit divided by (cash invested in dollars times holding days), in cents per $1 per day, scaled by 10000. */
  returnPerCapitalDayBps: Bps | null;
  capitalTiedUpCents: Cents;
  holdingDays: number | null;
}

export const ZERO_ACQUISITION: AcquisitionCosts = {
  purchasePriceCents: 0,
  purchaseTaxBps: 0,
  buyerFeesCents: 0,
  inboundShippingCents: 0,
  inspectionCents: 0,
  testingCents: 0,
  repairCents: 0,
  accessoriesCents: 0,
};

export function defaultSale(schedule: MarketplaceFeeSchedule, overrides: Partial<SaleAssumptions> = {}): SaleAssumptions {
  return {
    schedule,
    categoryId: null,
    adjustments: NO_ADJUSTMENTS,
    itemPriceCents: 0,
    shippingChargedCents: 0,
    buyerSalesTaxBps: 0,
    shippingLabelCents: 0,
    insuranceCents: 0,
    signatureCents: 0,
    packagingCents: 0,
    otherSellingCents: 0,
    returnsAllowanceBps: 0,
    damageRiskBps: 0,
    holdingDays: null,
    ...overrides,
  };
}

export function acquisitionCash(a: AcquisitionCosts): Cents {
  return a.purchasePriceCents + applyBps(a.purchasePriceCents, a.purchaseTaxBps) + a.buyerFeesCents + a.inboundShippingCents;
}

export function preparationCosts(a: AcquisitionCosts): Cents {
  return a.inspectionCents + a.testingCents + a.repairCents + a.accessoriesCents;
}

export function calculateProfit(input: ProfitInput): ProfitResult {
  const { acquisition, sale } = input;
  const buyerSubtotalCents = sale.itemPriceCents + sale.shippingChargedCents;
  const fees = calculateSaleFees(
    sale.schedule,
    {
      itemPriceCents: sale.itemPriceCents,
      shippingChargedCents: sale.shippingChargedCents,
      buyerSalesTaxBps: sale.buyerSalesTaxBps,
      categoryId: sale.categoryId,
    },
    sale.adjustments,
  );
  const sellingCostsCents = sale.shippingLabelCents + sale.insuranceCents + sale.signatureCents + sale.packagingCents + sale.otherSellingCents;
  const returnsAllowanceCents = applyBps(buyerSubtotalCents, sale.returnsAllowanceBps);
  const damageAllowanceCents = applyBps(buyerSubtotalCents, sale.damageRiskBps);

  const acquisitionCashCents = acquisitionCash(acquisition);
  const preparationCostsCents = preparationCosts(acquisition);
  const cashInvestedCents = acquisitionCashCents + preparationCostsCents + input.travelCostCents;

  const netProceedsCents = buyerSubtotalCents - fees.totalFeesCents - sellingCostsCents;
  const grossProfitCents = buyerSubtotalCents - acquisitionCashCents;
  const netProfitCents =
    netProceedsCents - returnsAllowanceCents - damageAllowanceCents - cashInvestedCents - input.riskAllowanceCents;

  const totalMinutes = input.sourcingMinutes === null ? null : input.sourcingMinutes + input.handlingMinutes;
  const profitPerHourCents = totalMinutes && totalMinutes > 0 ? roundHalfAway((netProfitCents * 60) / totalMinutes) : null;

  let returnPerCapitalDayBps: Bps | null = null;
  if (sale.holdingDays && sale.holdingDays > 0 && cashInvestedCents > 0) {
    returnPerCapitalDayBps = roundHalfAway((netProfitCents * 10_000) / (cashInvestedCents * sale.holdingDays));
  }

  return {
    buyerSubtotalCents,
    fees,
    sellingCostsCents,
    returnsAllowanceCents,
    damageAllowanceCents,
    acquisitionCashCents,
    preparationCostsCents,
    travelCostCents: input.travelCostCents,
    cashInvestedCents,
    riskAllowanceCents: input.riskAllowanceCents,
    netProceedsCents,
    grossProfitCents,
    netProfitCents,
    cashRoiBps: ratioBps(netProfitCents, cashInvestedCents),
    grossMarginBps: ratioBps(grossProfitCents, buyerSubtotalCents),
    netMarginBps: ratioBps(netProfitCents, buyerSubtotalCents),
    profitPerHourCents,
    returnPerCapitalDayBps,
    capitalTiedUpCents: cashInvestedCents,
    holdingDays: sale.holdingDays,
  };
}

function withPurchase(input: ProfitInput, purchasePriceCents: Cents): ProfitInput {
  return { ...input, acquisition: { ...input.acquisition, purchasePriceCents } };
}

function withItemPrice(input: ProfitInput, itemPriceCents: Cents): ProfitInput {
  return { ...input, sale: { ...input.sale, itemPriceCents } };
}

/** Lowest item price (cents) at which net profit is at least zero. */
export function breakEvenSalePrice(input: ProfitInput): Cents {
  let lo = 0;
  let hi = 100_000_000;
  if (calculateProfit(withItemPrice(input, hi)).netProfitCents < 0) return hi;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (calculateProfit(withItemPrice(input, mid)).netProfitCents >= 0) hi = mid;
    else lo = mid + 1;
  }
  // The per-order fee step can create a few cents of non-monotonicity; walk forward to a true break-even.
  let price = lo;
  while (calculateProfit(withItemPrice(input, price)).netProfitCents < 0) price += 1;
  return price;
}

export interface PurchaseConstraints {
  minNetProfitCents: Cents;
  minCashRoiBps: Bps;
}

/** Highest purchase price satisfying a predicate that is monotone (true then false as price rises). */
function maxPurchaseWhere(input: ProfitInput, ok: (r: ProfitResult) => boolean): Cents | null {
  if (!ok(calculateProfit(withPurchase(input, 0)))) return null;
  let lo = 0;
  let hi = Math.max(input.sale.itemPriceCents + input.sale.shippingChargedCents, 1);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ok(calculateProfit(withPurchase(input, mid)))) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Highest purchase price at which net profit is at least zero. */
export function breakEvenPurchasePrice(input: ProfitInput): Cents | null {
  return maxPurchaseWhere(input, (r) => r.netProfitCents >= 0);
}

/** Highest purchase price that still meets both the profit floor and the ROI floor. */
export function maxAcceptablePurchasePrice(input: ProfitInput, c: PurchaseConstraints): Cents | null {
  return maxPurchaseWhere(
    input,
    // With zero cash invested ROI is undefined; positive profit on no capital satisfies any ROI floor.
    (r) => r.netProfitCents >= c.minNetProfitCents && (r.cashRoiBps === null ? r.netProfitCents > 0 : r.cashRoiBps >= c.minCashRoiBps),
  );
}

export type ScenarioName = "conservative" | "base" | "optimistic";

export interface ScenarioAssumptions {
  itemPriceCents: Cents;
  holdingDays: number | null;
  /** Multiplier on variable selling costs, in bps (10000 = unchanged). */
  sellingCostMultiplierBps: Bps;
  /** Multiplier on the returns allowance, in bps. */
  returnsMultiplierBps: Bps;
}

export interface ScenarioResult {
  name: ScenarioName;
  assumptions: ScenarioAssumptions;
  result: ProfitResult;
}

export function applyScenario(input: ProfitInput, s: ScenarioAssumptions): ProfitInput {
  const m = (v: number) => applyBps(v, s.sellingCostMultiplierBps);
  return {
    ...input,
    sale: {
      ...input.sale,
      itemPriceCents: s.itemPriceCents,
      holdingDays: s.holdingDays,
      shippingLabelCents: m(input.sale.shippingLabelCents),
      packagingCents: m(input.sale.packagingCents),
      insuranceCents: m(input.sale.insuranceCents),
      returnsAllowanceBps: applyBps(input.sale.returnsAllowanceBps, s.returnsMultiplierBps),
    },
  };
}

export function runScenarios(input: ProfitInput, scenarios: Record<ScenarioName, ScenarioAssumptions>): ScenarioResult[] {
  return (["conservative", "base", "optimistic"] as const).map((name) => ({
    name,
    assumptions: scenarios[name],
    result: calculateProfit(applyScenario(input, scenarios[name])),
  }));
}
