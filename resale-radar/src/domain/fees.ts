import { applyBps, type Bps, type Cents } from "./money";

/**
 * Marketplace selling-fee model.
 *
 * Fee schedules are data, not code. Every schedule carries its source URL,
 * the effective date it was read from, and whether a human has verified it
 * against the official page. The UI surfaces unverified schedules as amber.
 */

export interface FeeTier {
  /** Upper bound of this tier on the fee basis, inclusive. Null means no upper bound. */
  upToCents: Cents | null;
  rateBps: Bps;
}

export interface CategoryFeeSchedule {
  id: string;
  label: string;
  tiers: FeeTier[];
  /** Some categories (e.g. sneakers above a threshold) waive the per-order fee. */
  perOrderFeeWaived?: boolean;
}

export interface PerOrderFeeRule {
  thresholdCents: Cents;
  atOrBelowCents: Cents;
  aboveCents: Cents;
}

export interface MarketplaceFeeSchedule {
  marketplace: string;
  label: string;
  effectiveDate: string;
  sourceUrl: string;
  verified: boolean;
  verifiedAt: string | null;
  notes: string;
  /** True when the variable fee basis includes buyer-paid shipping and sales tax. */
  basisIncludesShippingAndTax: boolean;
  perOrderFee: PerOrderFeeRule | null;
  defaultCategoryId: string;
  categories: CategoryFeeSchedule[];
}

export interface SellerFeeAdjustments {
  /** Top Rated Seller discount applied to the variable final value fee, in bps of that fee. */
  topRatedDiscountBps: Bps;
  /** Below-standard surcharge, in bps added to the variable rate. */
  belowStandardSurchargeBps: Bps;
  /** Promoted Listings (general / cost-per-sale) ad rate applied to item price plus shipping. */
  promotedRateBps: Bps;
  /** International fee rate when the buyer is outside the seller's country. */
  internationalFeeBps: Bps;
}

export const NO_ADJUSTMENTS: SellerFeeAdjustments = {
  topRatedDiscountBps: 0,
  belowStandardSurchargeBps: 0,
  promotedRateBps: 0,
  internationalFeeBps: 0,
};

/**
 * Default eBay US schedule. Values must be confirmed against the official
 * eBay fee page before the schedule is marked verified. See
 * docs/integration-feasibility.md for the verification record.
 */
export const EBAY_US_FEES: MarketplaceFeeSchedule = {
  marketplace: "ebay_us",
  label: "eBay US (managed payments)",
  effectiveDate: "2025-02-14",
  sourceUrl: "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822",
  verified: false,
  verifiedAt: null,
  notes:
    "Final value fee is calculated on the total amount of the sale, including item price, shipping, handling, and sales tax. Rates were matched against eBay pages through a search index on 2026-10-13 (see docs/integration-feasibility.md). Video game console and guitar rates are only partially confirmed. Confirm against the source URL, then mark verified in Settings.",
  basisIncludesShippingAndTax: true,
  perOrderFee: { thresholdCents: 1_000, atOrBelowCents: 30, aboveCents: 40 },
  defaultCategoryId: "most",
  categories: [
    { id: "most", label: "Most categories", tiers: [{ upToCents: 750_000, rateBps: 1_360 }, { upToCents: null, rateBps: 235 }] },
    { id: "books_media", label: "Books, DVDs, Movies, Music", tiers: [{ upToCents: 750_000, rateBps: 1_530 }, { upToCents: null, rateBps: 235 }] },
    { id: "trading_cards", label: "Trading cards, sports cards, comics", tiers: [{ upToCents: 750_000, rateBps: 1_325 }, { upToCents: null, rateBps: 235 }] },
    { id: "coins", label: "Coins and paper money", tiers: [{ upToCents: 750_000, rateBps: 1_325 }, { upToCents: null, rateBps: 235 }] },
    { id: "video_game_consoles", label: "Video game consoles (partially confirmed)", tiers: [{ upToCents: 250_000, rateBps: 735 }, { upToCents: null, rateBps: 235 }] },
    { id: "guitars", label: "Guitars and basses", tiers: [{ upToCents: 750_000, rateBps: 670 }, { upToCents: null, rateBps: 235 }] },
    { id: "watches", label: "Watches", tiers: [{ upToCents: 100_000, rateBps: 1_500 }, { upToCents: 750_000, rateBps: 650 }, { upToCents: null, rateBps: 300 }] },
    { id: "handbags", label: "Handbags", tiers: [{ upToCents: 200_000, rateBps: 1_500 }, { upToCents: null, rateBps: 900 }] },
    { id: "jewelry", label: "Jewelry", tiers: [{ upToCents: 500_000, rateBps: 1_500 }, { upToCents: null, rateBps: 900 }] },
  ],
};

/** Local cash sale (e.g. meeting a buyer in person). No platform fees. */
export const LOCAL_CASH_FEES: MarketplaceFeeSchedule = {
  marketplace: "local_cash",
  label: "Local cash sale",
  effectiveDate: "n/a",
  sourceUrl: "",
  verified: true,
  verifiedAt: null,
  notes: "No marketplace fees. Buyer pays in person.",
  basisIncludesShippingAndTax: false,
  perOrderFee: null,
  defaultCategoryId: "all",
  categories: [{ id: "all", label: "All", tiers: [{ upToCents: null, rateBps: 0 }] }],
};

export const FEE_SCHEDULES: Record<string, MarketplaceFeeSchedule> = {
  ebay_us: EBAY_US_FEES,
  local_cash: LOCAL_CASH_FEES,
};

export function findCategory(schedule: MarketplaceFeeSchedule, categoryId: string | null | undefined): CategoryFeeSchedule {
  const found = schedule.categories.find((c) => c.id === categoryId);
  if (found) return found;
  const fallback = schedule.categories.find((c) => c.id === schedule.defaultCategoryId);
  if (!fallback) throw new Error(`Fee schedule ${schedule.marketplace} has no default category`);
  return fallback;
}

/** Marginal tiered fee: each tier's rate applies only to the portion of the basis within it. */
export function tieredFee(basis: Cents, tiers: readonly FeeTier[], surchargeBps: Bps = 0): Cents {
  if (basis <= 0) return 0;
  let fee = 0;
  let lower = 0;
  for (const tier of tiers) {
    const upper = tier.upToCents ?? Number.POSITIVE_INFINITY;
    if (basis <= lower) break;
    const portion = Math.min(basis, upper) - lower;
    if (portion > 0) fee += (portion * (tier.rateBps + surchargeBps)) / 10_000;
    lower = upper;
  }
  return Math.round(fee);
}

export interface SaleFeeInput {
  /** Item price paid by the buyer (excluding shipping and tax). */
  itemPriceCents: Cents;
  /** Shipping charged to the buyer. Zero for free-shipping listings. */
  shippingChargedCents: Cents;
  /** Buyer sales tax rate collected by the marketplace (estimate when buyer is unknown). */
  buyerSalesTaxBps: Bps;
  categoryId?: string | null;
  international?: boolean;
}

export interface SaleFeeBreakdown {
  feeBasisCents: Cents;
  salesTaxCents: Cents;
  finalValueFeeCents: Cents;
  topRatedDiscountCents: Cents;
  perOrderFeeCents: Cents;
  promotedFeeCents: Cents;
  internationalFeeCents: Cents;
  totalFeesCents: Cents;
  categoryId: string;
  scheduleVerified: boolean;
}

export function calculateSaleFees(
  schedule: MarketplaceFeeSchedule,
  input: SaleFeeInput,
  adjustments: SellerFeeAdjustments = NO_ADJUSTMENTS,
): SaleFeeBreakdown {
  const category = findCategory(schedule, input.categoryId);
  const buyerSubtotal = input.itemPriceCents + input.shippingChargedCents;
  // Sales tax is collected from the buyer and remitted by the marketplace. The
  // seller never receives it, but the fee basis can include it.
  const salesTaxCents = applyBps(buyerSubtotal, input.buyerSalesTaxBps);
  const feeBasisCents = schedule.basisIncludesShippingAndTax ? buyerSubtotal + salesTaxCents : input.itemPriceCents;

  const rawFvf = tieredFee(feeBasisCents, category.tiers, adjustments.belowStandardSurchargeBps);
  const topRatedDiscountCents = applyBps(rawFvf, adjustments.topRatedDiscountBps);
  const finalValueFeeCents = rawFvf - topRatedDiscountCents;

  let perOrderFeeCents = 0;
  if (schedule.perOrderFee && !category.perOrderFeeWaived && buyerSubtotal > 0) {
    perOrderFeeCents =
      feeBasisCents <= schedule.perOrderFee.thresholdCents ? schedule.perOrderFee.atOrBelowCents : schedule.perOrderFee.aboveCents;
  }

  const promotedFeeCents = applyBps(buyerSubtotal, adjustments.promotedRateBps);
  const internationalFeeCents = input.international ? applyBps(feeBasisCents, adjustments.internationalFeeBps) : 0;

  return {
    feeBasisCents,
    salesTaxCents,
    finalValueFeeCents,
    topRatedDiscountCents,
    perOrderFeeCents,
    promotedFeeCents,
    internationalFeeCents,
    totalFeesCents: finalValueFeeCents + perOrderFeeCents + promotedFeeCents + internationalFeeCents,
    categoryId: category.id,
    scheduleVerified: schedule.verified,
  };
}
