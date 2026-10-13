import { z } from "zod";
import { DEFAULT_TRAVEL_SETTINGS, type TravelSettings } from "./travel";
import { DEFAULT_VALUATION_SETTINGS, type ValuationSettings } from "./valuation";
import { NO_ADJUSTMENTS, type SellerFeeAdjustments } from "./fees";
import type { Bps, Cents } from "./money";

export interface ScoreWeights {
  profitability: number;
  demand: number;
  pricingConfidence: number;
  identification: number;
  condition: number;
  turnover: number;
  effort: number;
  risk: number;
  freshness: number;
}

export interface BusinessSettings {
  homeLabel: string;
  /** Private starting point. Never exposed outside the owner's account. */
  homeLatitude: number | null;
  homeLongitude: number | null;
  startingCapitalCents: Cents;
  minCashRoiBps: Bps;
  preferredHorizonDays: number;
  cashReserveBps: Bps;
  maxSingleItemExposureBps: Bps;
  maxSpeculativeExposureBps: Bps;
  /** Largest discount from asking the system will suggest pursuing. */
  maxNegotiationDiscountBps: Bps;
  /** A stress-case loss (selling at the lowest qualifying comp) may not exceed this share of cash invested. */
  maxDownsideLossBps: Bps;
  minSoldComps: number;
  allowExceptionalTravel: boolean;
  defaultChannel: "ebay_us" | "local_cash";
  buyerSalesTaxBps: Bps;
  defaultHandlingMinutes: number;
  defaultPackagingCents: Cents;
  defaultReturnsAllowanceBps: Bps;
  defaultDamageRiskBps: Bps;
  conservativeSellingCostMultiplierBps: Bps;
  conservativeReturnsMultiplierBps: Bps;
  sellerAdjustments: SellerFeeAdjustments;
  monthlySoftwareBudgetCents: Cents;
  riskTolerance: "conservative" | "balanced" | "aggressive";
  negotiationMode: "manual" | "approval" | "authorized_automation";
  enabledCategories: string[];
  scoreWeights: ScoreWeights;
  travel: TravelSettings;
  valuation: ValuationSettings;
}

export const ALL_CATEGORIES = [
  "video_games", "game_consoles", "electronics", "computers", "phones_tablets", "dj_equipment", "audio_vintage", "cameras",
  "sports_cards", "trading_cards", "toys_vintage", "dolls", "lego", "artwork", "watches", "jewelry", "handbags",
  "autographs", "coins", "glassware_pottery", "furniture", "musical_instruments", "other",
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  video_games: "Video games",
  game_consoles: "Game consoles",
  electronics: "Electronics",
  computers: "Computers",
  phones_tablets: "Phones and tablets",
  dj_equipment: "DJ equipment",
  audio_vintage: "Vintage audio and stereo",
  cameras: "Cameras and lenses",
  sports_cards: "Sports cards",
  trading_cards: "Trading cards",
  toys_vintage: "Vintage toys and figures",
  dolls: "Collectible dolls",
  lego: "LEGO",
  artwork: "Artwork and prints",
  watches: "Watches",
  jewelry: "Jewelry",
  handbags: "Handbags",
  autographs: "Autographs and memorabilia",
  coins: "Coins",
  glassware_pottery: "Glassware, pottery, ceramics",
  furniture: "Furniture",
  musical_instruments: "Musical instruments",
  other: "Other",
};

/** Maps a sourcing category to an eBay fee category id. */
export const CATEGORY_FEE_MAP: Record<string, string> = {
  sports_cards: "trading_cards",
  trading_cards: "trading_cards",
  coins: "coins",
  watches: "watches",
  jewelry: "jewelry",
  handbags: "handbags",
  musical_instruments: "guitars",
  game_consoles: "video_game_consoles",
};

export const DEFAULT_SETTINGS: BusinessSettings = {
  homeLabel: "Lockport, Illinois",
  homeLatitude: null,
  homeLongitude: null,
  startingCapitalCents: 100_000,
  minCashRoiBps: 2_500,
  preferredHorizonDays: 30,
  cashReserveBps: 2_000,
  maxSingleItemExposureBps: 4_000,
  maxSpeculativeExposureBps: 1_500,
  maxNegotiationDiscountBps: 3_500,
  maxDownsideLossBps: 2_500,
  minSoldComps: 3,
  allowExceptionalTravel: true,
  defaultChannel: "ebay_us",
  buyerSalesTaxBps: 800,
  defaultHandlingMinutes: 20,
  defaultPackagingCents: 150,
  defaultReturnsAllowanceBps: 200,
  defaultDamageRiskBps: 100,
  conservativeSellingCostMultiplierBps: 11_500,
  conservativeReturnsMultiplierBps: 15_000,
  sellerAdjustments: NO_ADJUSTMENTS,
  monthlySoftwareBudgetCents: 5_000,
  riskTolerance: "conservative",
  negotiationMode: "approval",
  enabledCategories: [...ALL_CATEGORIES],
  scoreWeights: {
    profitability: 25,
    demand: 15,
    pricingConfidence: 15,
    identification: 10,
    condition: 5,
    turnover: 10,
    effort: 5,
    risk: 10,
    freshness: 5,
  },
  travel: DEFAULT_TRAVEL_SETTINGS,
  valuation: DEFAULT_VALUATION_SETTINGS,
};

const cents = z.number().int().min(0);
const bps = z.number().int().min(0).max(1_000_000);

export const travelTierSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  maxOneWayMinutes: z.number().int().positive().nullable(),
  minNetProfitCents: cents,
  requiresManualReview: z.boolean(),
});

export const vehicleSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("mileage_rate"), rateCentsPerMile: z.number().min(0).max(500) }),
  z.object({
    method: z.literal("actual_expense"),
    fuelPriceCentsPerGallon: z.number().min(0).max(2_000),
    milesPerGallon: z.number().positive().max(200),
    maintenanceCentsPerMile: z.number().min(0).max(200),
    depreciationCentsPerMile: z.number().min(0).max(200),
  }),
]);

export const travelSettingsSchema = z.object({
  vehicle: vehicleSchema,
  tiers: z.array(travelTierSchema).min(1),
  localAreaMinutes: z.number().int().positive().max(240),
  maxTravelMinutes: z.number().int().positive().max(600),
  defaultPickupMinutes: z.number().int().min(0).max(240),
  approximateLocationBufferMinutes: z.number().int().min(0).max(60),
  wastedTripRateBps: bps,
  ownerHourlyValueCents: cents,
  minProfitPerHourOutsideLocalCents: cents,
}) satisfies z.ZodType<TravelSettings>;

export const valuationSettingsSchema = z.object({
  minMatchConfidence: z.number().min(0).max(1),
  maxCompAgeDays: z.number().int().positive().max(3650),
  outlierZ: z.number().positive(),
  trimFraction: z.number().min(0).max(0.4),
}) satisfies z.ZodType<ValuationSettings>;

export const businessSettingsSchema = z.object({
  homeLabel: z.string().min(1).max(120),
  homeLatitude: z.number().min(-90).max(90).nullable(),
  homeLongitude: z.number().min(-180).max(180).nullable(),
  startingCapitalCents: cents,
  minCashRoiBps: bps,
  preferredHorizonDays: z.number().int().positive().max(365),
  cashReserveBps: bps.max(10_000),
  maxSingleItemExposureBps: bps.max(10_000),
  maxSpeculativeExposureBps: bps.max(10_000),
  maxNegotiationDiscountBps: bps.max(10_000),
  maxDownsideLossBps: bps.max(10_000),
  minSoldComps: z.number().int().min(1).max(50),
  allowExceptionalTravel: z.boolean(),
  defaultChannel: z.enum(["ebay_us", "local_cash"]),
  buyerSalesTaxBps: bps.max(2_000),
  defaultHandlingMinutes: z.number().int().min(0).max(600),
  defaultPackagingCents: cents,
  defaultReturnsAllowanceBps: bps.max(5_000),
  defaultDamageRiskBps: bps.max(5_000),
  conservativeSellingCostMultiplierBps: bps,
  conservativeReturnsMultiplierBps: bps,
  sellerAdjustments: z.object({
    topRatedDiscountBps: bps.max(10_000),
    belowStandardSurchargeBps: bps.max(2_000),
    promotedRateBps: bps.max(10_000),
    internationalFeeBps: bps.max(2_000),
  }),
  monthlySoftwareBudgetCents: cents,
  riskTolerance: z.enum(["conservative", "balanced", "aggressive"]),
  negotiationMode: z.enum(["manual", "approval", "authorized_automation"]),
  enabledCategories: z.array(z.string()),
  scoreWeights: z.object({
    profitability: z.number().min(0),
    demand: z.number().min(0),
    pricingConfidence: z.number().min(0),
    identification: z.number().min(0),
    condition: z.number().min(0),
    turnover: z.number().min(0),
    effort: z.number().min(0),
    risk: z.number().min(0),
    freshness: z.number().min(0),
  }),
  travel: travelSettingsSchema,
  valuation: valuationSettingsSchema,
}) satisfies z.ZodType<BusinessSettings>;

/** Merge stored (possibly partial or older) settings over the defaults. */
export function resolveSettings(stored: unknown): BusinessSettings {
  if (!stored || typeof stored !== "object") return DEFAULT_SETTINGS;
  const s = stored as Partial<BusinessSettings>;
  const merged: BusinessSettings = {
    ...DEFAULT_SETTINGS,
    ...s,
    sellerAdjustments: { ...DEFAULT_SETTINGS.sellerAdjustments, ...(s.sellerAdjustments ?? {}) },
    scoreWeights: { ...DEFAULT_SETTINGS.scoreWeights, ...(s.scoreWeights ?? {}) },
    travel: { ...DEFAULT_SETTINGS.travel, ...(s.travel ?? {}) },
    valuation: { ...DEFAULT_SETTINGS.valuation, ...(s.valuation ?? {}) },
  };
  const parsed = businessSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}
