import { FEE_SCHEDULES } from "./fees";
import { estimateLiquidity, type LiquidityEstimate, type LiquidityInput, LIQUIDITY_LABELS } from "./liquidity";
import { formatBps, formatCents, type Cents } from "./money";
import { buildOfferLadder, type OfferLadder } from "./negotiation";
import {
  breakEvenPurchasePrice,
  breakEvenSalePrice,
  calculateProfit,
  defaultSale,
  maxAcceptablePurchasePrice,
  applyScenario,
  runScenarios,
  type AcquisitionCosts,
  type ProfitInput,
  type ScenarioAssumptions,
  type ScenarioName,
  type ScenarioResult,
} from "./profit";
import { categoryRisk, makeRisk, riskAllowanceCents, unresolvedCritical, type RiskFactor } from "./risk";
import { CATEGORY_FEE_MAP, type BusinessSettings } from "./settings";
import { computeTravelCost, qualifyTravel, type RouteEstimate, type TravelCostBreakdown, type TravelQualification } from "./travel";
import { valueFromComparables, type Comparable, type Valuation } from "./valuation";

export const DECISIONS = [
  "STRONG_BUY",
  "BUY_IF_NEGOTIATED",
  "WORTH_THE_DRIVE",
  "HIDDEN_GEM",
  "RESEARCH_REQUIRED",
  "PASS",
  "UNAVAILABLE",
] as const;
export type Decision = (typeof DECISIONS)[number];

export const DECISION_LABELS: Record<Decision, string> = {
  STRONG_BUY: "Strong Buy",
  BUY_IF_NEGOTIATED: "Buy If Negotiated",
  WORTH_THE_DRIVE: "Worth the Drive",
  HIDDEN_GEM: "Hidden Gem",
  RESEARCH_REQUIRED: "Research Required",
  PASS: "Pass",
  UNAVAILABLE: "Unavailable",
};

export type IdentityStatus = "verified" | "probable" | "unverified";
export type AuthenticityStatus = "verified" | "not_required" | "unverified" | "failed";

export interface OpportunityInput {
  askingPriceCents: Cents;
  category: string | null;
  listingAvailable: boolean;
  identity: { status: IdentityStatus; confidence: number };
  authenticity: AuthenticityStatus;
  conditionConfidence: number;
  functionalityTested: boolean;
  comps: Comparable[];
  liquidity: LiquidityInput;
  route: RouteEstimate;
  pickupMinutes?: number;
  /** Acquisition costs other than the purchase price. */
  extraAcquisition?: Partial<Omit<AcquisitionCosts, "purchasePriceCents">>;
  shippingLabelCents: Cents;
  insuranceCents?: Cents;
  signatureCents?: Cents;
  packagingCents?: Cents;
  channel?: "ebay_us" | "local_cash";
  manualRiskFactors?: RiskFactor[];
  hiddenGem?: { flagged: boolean; potentialHighCents: Cents | null; rationale: string } | null;
  buyingPowerCents: Cents | null;
  listingObservedAt?: string | null;
}

export interface HardFilter {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface ScoreComponent {
  key: keyof BusinessSettings["scoreWeights"];
  label: string;
  value: number;
  weight: number;
}

export interface Explanation {
  whyUndervalued: string;
  identityEvidence: string;
  comparableSales: string;
  demand: string;
  timeToSale: string;
  offer: string;
  maxPrice: string;
  netProfit: string;
  risks: string[];
  invalidators: string[];
}

export interface Evaluation {
  decision: Decision;
  decisionReason: string;
  requiresManualReview: boolean;
  valuation: Valuation;
  liquidity: LiquidityEstimate;
  travel: TravelCostBreakdown;
  travelQualification: TravelQualification;
  riskFactors: RiskFactor[];
  riskAllowanceCents: Cents;
  scenariosAtAsking: ScenarioResult[] | null;
  stressNetProfitCents: Cents | null;
  breakEvenSalePriceCents: Cents | null;
  breakEvenPurchasePriceCents: Cents | null;
  maxPurchasePriceCents: Cents | null;
  offers: OfferLadder | null;
  hardFilters: HardFilter[];
  score: number;
  scoreComponents: ScoreComponent[];
  explanation: Explanation;
  computedAt: string;
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function deriveRiskFactors(input: OpportunityInput, valuation: Valuation, liquidity: LiquidityEstimate, travel: TravelCostBreakdown): RiskFactor[] {
  const factors: RiskFactor[] = [];
  const profile = categoryRisk(input.category);
  if (input.identity.status !== "verified") factors.push(makeRisk("identity_unverified"));
  if (input.authenticity === "failed") factors.push(makeRisk("authenticity_unverified", "Authentication failed or the item is a reproduction."));
  else if (profile.authenticationRequired && input.authenticity === "unverified") factors.push(makeRisk("authenticity_unverified"));
  if (profile.electronics && !input.functionalityTested) factors.push(makeRisk("untested_electronics"));
  if (input.conditionConfidence < 0.6) factors.push(makeRisk("condition_unclear"));
  if (valuation.status === "valued" && valuation.sampleSize < 4) factors.push(makeRisk("thin_comps"));
  if (valuation.medianAgeDays !== null && valuation.medianAgeDays > 90) factors.push(makeRisk("stale_comps"));
  if (valuation.trendBpsPer30d !== null && valuation.trendBpsPer30d < -500) {
    factors.push(makeRisk("declining_trend", `Sold prices are falling about ${formatBps(-valuation.trendBpsPer30d)} per month.`));
  }
  if (liquidity.soldToActiveRatioBps !== null && liquidity.soldToActiveRatioBps < 3_000 && liquidity.classification !== "unknown") {
    factors.push(makeRisk("weak_demand"));
  }
  if (valuation.conservativeCents && input.askingPriceCents < valuation.conservativeCents * 0.35) factors.push(makeRisk("price_too_good"));
  if (profile.fragile) factors.push(makeRisk("fragile_shipping"));
  if (travel.status === "provisional") factors.push(makeRisk("provisional_location"));
  for (const m of input.manualRiskFactors ?? []) {
    const existing = factors.findIndex((f) => f.code === m.code);
    if (existing >= 0) factors[existing] = m;
    else factors.push(m);
  }
  return factors;
}

export function evaluateOpportunity(input: OpportunityInput, settings: BusinessSettings, now: Date = new Date()): Evaluation {
  const valuation = valueFromComparables(input.comps, now, settings.valuation);
  const liquidity = estimateLiquidity(input.liquidity);
  const travel = computeTravelCost(input.route, settings.travel, input.pickupMinutes);
  const travelQualification = qualifyTravel(travel, settings.travel);
  const riskFactors = deriveRiskFactors(input, valuation, liquidity, travel);
  const critical = unresolvedCritical(riskFactors);
  const channel = input.channel ?? settings.defaultChannel;
  const schedule = FEE_SCHEDULES[channel]!;
  const feeCategory = input.category ? CATEGORY_FEE_MAP[input.category] ?? null : null;
  const riskAllowance = valuation.baseCents ? riskAllowanceCents(valuation.baseCents, input.category, riskFactors) : 0;

  const profitInput: ProfitInput = {
    acquisition: {
      purchasePriceCents: input.askingPriceCents,
      purchaseTaxBps: 0,
      buyerFeesCents: 0,
      inboundShippingCents: 0,
      inspectionCents: 0,
      testingCents: 0,
      repairCents: 0,
      accessoriesCents: 0,
      ...input.extraAcquisition,
    },
    sale: defaultSale(schedule, {
      categoryId: feeCategory,
      adjustments: channel === "ebay_us" ? settings.sellerAdjustments : defaultSale(schedule).adjustments,
      buyerSalesTaxBps: channel === "ebay_us" ? settings.buyerSalesTaxBps : 0,
      shippingLabelCents: channel === "ebay_us" ? input.shippingLabelCents : 0,
      insuranceCents: input.insuranceCents ?? 0,
      signatureCents: input.signatureCents ?? 0,
      packagingCents: channel === "ebay_us" ? input.packagingCents ?? settings.defaultPackagingCents : 0,
      returnsAllowanceBps: channel === "ebay_us" ? settings.defaultReturnsAllowanceBps : 0,
      damageRiskBps: channel === "ebay_us" ? settings.defaultDamageRiskBps : 0,
    }),
    travelCostCents: travel.totalTravelCostCents,
    riskAllowanceCents: riskAllowance,
    sourcingMinutes: travel.totalSourcingMinutes,
    handlingMinutes: settings.defaultHandlingMinutes,
  };

  let scenariosAtAsking: ScenarioResult[] | null = null;
  let stressNet: Cents | null = null;
  let breakEvenSale: Cents | null = null;
  let breakEvenPurchase: Cents | null = null;
  let maxPurchase: Cents | null = null;
  let scenarioDefs: Record<ScenarioName, ScenarioAssumptions> | null = null;

  if (valuation.status === "valued") {
    const horizon = settings.preferredHorizonDays;
    scenarioDefs = {
      conservative: {
        itemPriceCents: valuation.conservativeCents!,
        holdingDays: liquidity.daysToSellHigh ?? horizon * 2,
        sellingCostMultiplierBps: settings.conservativeSellingCostMultiplierBps,
        returnsMultiplierBps: settings.conservativeReturnsMultiplierBps,
      },
      base: {
        itemPriceCents: valuation.baseCents!,
        holdingDays: liquidity.daysToSellBase ?? horizon,
        sellingCostMultiplierBps: 10_000,
        returnsMultiplierBps: 10_000,
      },
      optimistic: {
        itemPriceCents: valuation.optimisticCents!,
        holdingDays: liquidity.daysToSellLow ?? Math.round(horizon / 2),
        sellingCostMultiplierBps: 10_000,
        returnsMultiplierBps: 10_000,
      },
    };
    scenariosAtAsking = runScenarios(profitInput, scenarioDefs);
    const conservativeInput = applyScenario(profitInput, scenarioDefs.conservative);
    stressNet = calculateProfit(applyScenario(profitInput, { ...scenarioDefs.conservative, itemPriceCents: valuation.lowCents! })).netProfitCents;
    breakEvenSale = breakEvenSalePrice(profitInput);
    breakEvenPurchase = breakEvenPurchasePrice(conservativeInput);
    if (travelQualification.requiredNetProfitCents !== null) {
      maxPurchase = maxAcceptablePurchasePrice(conservativeInput, {
        minNetProfitCents: travelQualification.requiredNetProfitCents,
        minCashRoiBps: settings.minCashRoiBps,
      });
    }
  }

  const conservative = scenariosAtAsking?.find((s) => s.name === "conservative")?.result ?? null;
  const base = scenariosAtAsking?.find((s) => s.name === "base")?.result ?? null;
  const required = travelQualification.requiredNetProfitCents;

  const hardFilters: HardFilter[] = [
    {
      id: "identity",
      label: "Verifiable item identity",
      passed: input.identity.status === "verified",
      detail: input.identity.status === "verified" ? "Identity confirmed." : `Identity is ${input.identity.status}.`,
    },
    {
      id: "critical_risk",
      label: "No unresolved critical issue",
      passed: critical.length === 0,
      detail: critical.length === 0 ? "None." : critical.map((c) => c.title).join(", "),
    },
    {
      id: "comps",
      label: `At least ${settings.minSoldComps} qualifying sold comparables`,
      passed: valuation.sampleSize >= settings.minSoldComps,
      detail: `${valuation.sampleSize} qualifying sold comparable${valuation.sampleSize === 1 ? "" : "s"}.`,
    },
    {
      id: "demand",
      label: "Credible resale demand",
      passed: ["highly_liquid", "liquid", "moderate"].includes(liquidity.classification),
      detail: `${LIQUIDITY_LABELS[liquidity.classification]} (${liquidity.demandLabel}).`,
    },
    {
      id: "roi",
      label: `Conservative cash ROI of at least ${formatBps(settings.minCashRoiBps)}`,
      passed: conservative?.cashRoiBps != null && conservative.cashRoiBps >= settings.minCashRoiBps,
      detail: conservative ? `Conservative ROI ${formatBps(conservative.cashRoiBps)} at asking.` : "Cannot compute without sold comparables.",
    },
    {
      id: "profit",
      label: required !== null ? `Conservative net profit of at least ${formatCents(required)} for this distance` : "Net profit meets the distance threshold",
      passed: conservative !== null && required !== null && conservative.netProfitCents >= required,
      detail:
        conservative && required !== null
          ? `Conservative net ${formatCents(conservative.netProfitCents)} vs ${formatCents(required)} required (${travelQualification.tier?.label}).`
          : required === null
            ? "Drive time unknown, so the profit threshold cannot be selected."
            : "Cannot compute without sold comparables.",
    },
    {
      id: "capital",
      label: "Within available buying power",
      passed: input.buyingPowerCents === null || (conservative?.cashInvestedCents ?? input.askingPriceCents) <= input.buyingPowerCents,
      detail: input.buyingPowerCents === null ? "Buying power not set." : `Buying power ${formatCents(input.buyingPowerCents)}.`,
    },
    {
      id: "downside",
      label: "Acceptable downside",
      passed: stressNet !== null && conservative !== null && -stressNet <= (conservative.cashInvestedCents * settings.maxDownsideLossBps) / 10_000,
      detail: stressNet !== null ? `Selling at the lowest qualifying comp nets ${formatCents(stressNet)}.` : "Unknown.",
    },
    {
      id: "travel",
      label: "Pickup within travel limits",
      passed: travel.status === "not_required" || (travelQualification.tier !== null && !travelQualification.beyondMaxTravel),
      detail:
        travel.status === "unknown"
          ? "Drive time unknown."
          : travelQualification.beyondMaxTravel
            ? `Beyond the ${settings.travel.maxTravelMinutes}-minute maximum.`
            : travel.status === "not_required"
              ? "Ships to you."
              : `${travel.oneWayMinutes} min one way${travel.status === "provisional" ? " (provisional)" : ""}.`,
    },
  ];

  const outsideLocal = travelQualification.outsideLocalArea;
  if (outsideLocal) {
    const pph = conservative?.profitPerHourCents ?? null;
    hardFilters.push({
      id: "profit_per_hour",
      label: `At least ${formatCents(settings.travel.minProfitPerHourOutsideLocalCents)} per sourcing hour outside the local area`,
      passed: pph !== null && pph >= settings.travel.minProfitPerHourOutsideLocalCents,
      detail: pph !== null ? `${formatCents(pph)} per hour, including listing and shipping time.` : "Unknown.",
    });
  }

  const allPass = hardFilters.every((f) => f.passed);
  const evidenceGap = !hardFilters.find((f) => f.id === "identity")!.passed || !hardFilters.find((f) => f.id === "comps")!.passed || liquidity.classification === "unknown";
  const fraudCritical = critical.some((c) => c.code === "possible_stolen" || c.code === "suspicious_payment");

  let decision: Decision;
  let reason: string;
  let manualReview = travelQualification.requiresManualReview;

  if (!input.listingAvailable) {
    decision = "UNAVAILABLE";
    reason = "The listing is no longer available.";
  } else if (fraudCritical) {
    decision = "PASS";
    reason = `Material risk: ${critical.map((c) => c.title).join(", ")}.`;
  } else if (evidenceGap) {
    if (input.hiddenGem?.flagged) {
      decision = "HIDDEN_GEM";
      reason = "Potentially overlooked value. Verification is required before any purchase decision.";
    } else {
      decision = "RESEARCH_REQUIRED";
      reason = hardFilters.filter((f) => ["identity", "comps"].includes(f.id) && !f.passed).map((f) => f.detail).join(" ") || "Demand data is missing.";
    }
  } else if (travel.status === "unknown") {
    decision = "RESEARCH_REQUIRED";
    reason = "Add the pickup area or drive time so travel costs and the distance threshold can be applied.";
  } else if (travelQualification.beyondMaxTravel || (outsideLocal && !settings.allowExceptionalTravel)) {
    decision = "PASS";
    reason = travelQualification.beyondMaxTravel
      ? `Beyond your ${settings.travel.maxTravelMinutes}-minute travel limit.`
      : "Outside your local area and exceptional travel is turned off.";
  } else if (allPass) {
    if (outsideLocal) {
      decision = "WORTH_THE_DRIVE";
      reason = `Verified economics clear the ${travelQualification.tier?.label} threshold of ${formatCents(required)} after travel costs.`;
    } else {
      decision = "STRONG_BUY";
      reason = "All evidence and financial requirements pass at the asking price.";
    }
  } else if (
    critical.length === 0 &&
    maxPurchase !== null &&
    maxPurchase < input.askingPriceCents &&
    maxPurchase >= Math.round((input.askingPriceCents * (10_000 - settings.maxNegotiationDiscountBps)) / 10_000) &&
    hardFilters.filter((f) => !f.passed).every((f) => ["roi", "profit", "downside", "profit_per_hour", "capital"].includes(f.id))
  ) {
    decision = "BUY_IF_NEGOTIATED";
    reason = `Qualifies at or below ${formatCents(maxPurchase)}.`;
  } else if (critical.length > 0 && input.hiddenGem?.flagged) {
    decision = "HIDDEN_GEM";
    reason = `Potential value, but unresolved: ${critical.map((c) => c.title).join(", ")}.`;
  } else if (critical.length > 0) {
    decision = "RESEARCH_REQUIRED";
    reason = `Resolve before buying: ${critical.map((c) => c.title).join(", ")}.`;
  } else {
    decision = "PASS";
    reason = hardFilters.filter((f) => !f.passed).map((f) => f.label).join("; ") || "Requirements not met.";
  }
  if (decision === "WORTH_THE_DRIVE" && travelQualification.requiresManualReview) manualReview = true;

  const offers = buildOfferLadder(input.askingPriceCents, maxPurchase, settings.maxNegotiationDiscountBps);

  // Explainable score. It is a ranking aid, not a probability of profit.
  const w = settings.scoreWeights;
  const daysBase = liquidity.daysToSellBase;
  const severityPenalty = riskFactors.filter((f) => !f.resolved).reduce((a, f) => a + ({ critical: 40, high: 20, medium: 10, low: 4 } as const)[f.severity], 0);
  const observedHours = input.listingObservedAt ? (now.getTime() - new Date(input.listingObservedAt).getTime()) / 3_600_000 : null;
  const scoreComponents: ScoreComponent[] = [
    { key: "profitability", label: "Profitability", weight: w.profitability, value: conservative && required ? clamp((conservative.netProfitCents / required) * 50) : 0 },
    { key: "demand", label: "Market demand", weight: w.demand, value: ({ highly_liquid: 100, liquid: 80, moderate: 55, slow_moving: 30, speculative: 10, unknown: 0 } as const)[liquidity.classification] },
    { key: "pricingConfidence", label: "Pricing confidence", weight: w.pricingConfidence, value: clamp(valuation.confidence * 100) },
    { key: "identification", label: "Identification confidence", weight: w.identification, value: clamp(input.identity.confidence * 100) },
    { key: "condition", label: "Condition confidence", weight: w.condition, value: clamp(input.conditionConfidence * 100) },
    { key: "turnover", label: "Expected turnover", weight: w.turnover, value: daysBase === null ? 0 : daysBase <= 7 ? 100 : daysBase <= 14 ? 85 : daysBase <= 30 ? 65 : daysBase <= 60 ? 40 : 20 },
    { key: "effort", label: "Acquisition effort", weight: w.effort, value: travel.totalSourcingMinutes === null ? 30 : clamp(100 - travel.totalSourcingMinutes / 1.5) },
    { key: "risk", label: "Financial risk", weight: w.risk, value: clamp(100 - severityPenalty) },
    { key: "freshness", label: "Data freshness", weight: w.freshness, value: clamp((valuation.medianAgeDays === null ? 40 : 100 - valuation.medianAgeDays / 1.8) * (observedHours !== null && observedHours > 48 ? 0.6 : 1)) },
  ];
  const totalWeight = scoreComponents.reduce((a, c) => a + c.weight, 0) || 1;
  const score = Math.round(scoreComponents.reduce((a, c) => a + c.value * c.weight, 0) / totalWeight);

  const explanation: Explanation = {
    whyUndervalued:
      valuation.conservativeCents && valuation.medianCents
        ? `Asking ${formatCents(input.askingPriceCents)} versus a conservative resale value of ${formatCents(valuation.conservativeCents)} and a median sold price of ${formatCents(valuation.medianCents)}.`
        : input.hiddenGem?.flagged
          ? `${input.hiddenGem.rationale} This is a hypothesis, not a verified valuation.`
          : "No verified resale value yet, so undervaluation cannot be established.",
    identityEvidence:
      input.identity.status === "verified"
        ? `Identity confirmed (confidence ${Math.round(input.identity.confidence * 100)}%).`
        : `Identity is ${input.identity.status} (confidence ${Math.round(input.identity.confidence * 100)}%). Confirm model, variant, and markings before buying.`,
    comparableSales:
      valuation.status === "valued"
        ? `${valuation.sampleSize} qualifying sold comparables, range ${formatCents(valuation.lowCents)} to ${formatCents(valuation.highCents)}${valuation.medianAgeDays !== null ? `, median age ${valuation.medianAgeDays} days` : ""}.`
        : "No qualifying sold comparables recorded. Active listings are not used as resale value.",
    demand:
      liquidity.soldToActiveRatioBps !== null
        ? `Sold-to-active ratio ${formatBps(liquidity.soldToActiveRatioBps)} (${liquidity.demandLabel}). This is a demand indicator, not a probability of sale.`
        : "Demand unknown. Record sold and active counts.",
    timeToSale:
      liquidity.daysToSellBase !== null
        ? `Estimated ${liquidity.daysToSellLow} to ${liquidity.daysToSellHigh} days (base ${liquidity.daysToSellBase}).`
        : "Unknown.",
    offer: offers ? `Open at ${formatCents(offers.openingOfferCents)}, target ${formatCents(offers.targetPriceCents)}.` : "No offer recommended.",
    maxPrice: maxPurchase !== null ? `Never pay more than ${formatCents(maxPurchase)}.` : "No safe maximum could be established.",
    netProfit:
      conservative && base
        ? `Net profit at asking: ${formatCents(conservative.netProfitCents)} conservative, ${formatCents(base.netProfitCents)} base, after fees, shipping, supplies, travel, and risk allowances.`
        : "Cannot be calculated without sold comparables.",
    risks: riskFactors.filter((f) => !f.resolved).map((f) => `${f.title}: ${f.detail}`),
    invalidators: [
      "Item does not match the identified model, variant, or condition in person.",
      "Item fails functional testing or is missing key accessories.",
      ...(categoryRisk(input.category).authenticationRequired ? ["Authentication fails or provenance cannot be established."] : []),
      ...(valuation.trendBpsPer30d !== null && valuation.trendBpsPer30d < 0 ? ["Sold prices continue to fall before you can list."] : []),
      "Seller raises the price above your maximum.",
    ],
  };

  return {
    decision,
    decisionReason: reason,
    requiresManualReview: manualReview,
    valuation,
    liquidity,
    travel,
    travelQualification,
    riskFactors,
    riskAllowanceCents: riskAllowance,
    scenariosAtAsking,
    stressNetProfitCents: stressNet,
    breakEvenSalePriceCents: breakEvenSale,
    breakEvenPurchasePriceCents: breakEvenPurchase,
    maxPurchasePriceCents: maxPurchase,
    offers,
    hardFilters,
    score,
    scoreComponents,
    explanation,
    computedAt: now.toISOString(),
  };
}

/**
 * Net profit for each scenario at an alternative purchase price. Valid when purchase tax is zero
 * (private-party purchases), where profit moves one-for-one with price.
 */
export function profitAtPrice(evaluation: Evaluation, askingPriceCents: Cents, purchasePriceCents: Cents) {
  if (!evaluation.scenariosAtAsking) return null;
  const delta = purchasePriceCents - askingPriceCents;
  return evaluation.scenariosAtAsking.map((s) => ({
    name: s.name,
    netProfitCents: s.result.netProfitCents - delta,
    cashInvestedCents: s.result.cashInvestedCents + delta,
    cashRoiBps: s.result.cashInvestedCents + delta > 0 ? Math.round(((s.result.netProfitCents - delta) * 10_000) / (s.result.cashInvestedCents + delta)) : null,
  }));
}
