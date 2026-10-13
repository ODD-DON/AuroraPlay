import { applyBps, roundHalfAway, type Bps, type Cents } from "./money";

/**
 * Travel economics and the distance-based profit tiers.
 *
 * Distance is a cost, not a barrier: every trip is converted to dollars and
 * minutes, and the required profit rises with drive time.
 */

/**
 * Vehicle cost is modeled with exactly one method. The discriminated union
 * makes double counting impossible: the mileage rate already includes fuel,
 * maintenance, tires, insurance, and depreciation, so the mileage variant has
 * no fuel field. Tolls and parking are always separate because neither
 * method includes them.
 */
export type VehicleCostMethod =
  | { method: "mileage_rate"; rateCentsPerMile: number }
  | {
      method: "actual_expense";
      fuelPriceCentsPerGallon: number;
      milesPerGallon: number;
      maintenanceCentsPerMile: number;
      depreciationCentsPerMile: number;
    };

export type RouteSource = "google_routes" | "manual" | "shipped" | "unknown";
export type LocationPrecision = "exact" | "approximate" | "unknown";

export interface RouteEstimate {
  source: RouteSource;
  precision: LocationPrecision;
  trafficAware: boolean;
  oneWayMinutes: number | null;
  oneWayMiles: number | null;
  tollsCents: Cents;
  parkingCents: Cents;
  computedAt: string | null;
}

export interface TravelTier {
  id: string;
  label: string;
  /** Inclusive upper bound of one-way drive time in minutes. Null means unbounded. */
  maxOneWayMinutes: number | null;
  minNetProfitCents: Cents;
  requiresManualReview: boolean;
}

export const DEFAULT_TRAVEL_TIERS: TravelTier[] = [
  { id: "local", label: "0 to 20 min", maxOneWayMinutes: 20, minNetProfitCents: 6_000, requiresManualReview: false },
  { id: "near", label: "21 to 30 min", maxOneWayMinutes: 30, minNetProfitCents: 10_000, requiresManualReview: false },
  { id: "regional", label: "31 to 45 min", maxOneWayMinutes: 45, minNetProfitCents: 17_500, requiresManualReview: false },
  { id: "far", label: "46 to 60 min", maxOneWayMinutes: 60, minNetProfitCents: 30_000, requiresManualReview: false },
  { id: "extended", label: "Over 60 min", maxOneWayMinutes: null, minNetProfitCents: 50_000, requiresManualReview: true },
];

export interface TravelSettings {
  vehicle: VehicleCostMethod;
  tiers: TravelTier[];
  /** One-way drive time that defines the normal local sourcing area. */
  localAreaMinutes: number;
  /** Hard ceiling for any alert, even exceptional ones. */
  maxTravelMinutes: number;
  /** Time at the seller's location to inspect, test, and pay. */
  defaultPickupMinutes: number;
  /** Added to one-way time when only an approximate area is known. */
  approximateLocationBufferMinutes: number;
  /** Chance a trip is wasted (no-show, item misdescribed, sold en route). */
  wastedTripRateBps: Bps;
  /** Owner's time value. Tracked separately from operating profit. */
  ownerHourlyValueCents: Cents;
  /** Minimum profit per sourcing hour for trips outside the local area. */
  minProfitPerHourOutsideLocalCents: Cents;
}

export const DEFAULT_TRAVEL_SETTINGS: TravelSettings = {
  // IRS business rate: 72.5 cents (Jan to Jun 2026, irs.gov); 76 cents from 2026-07-01 per Announcement 2026-11 (confirm).
  vehicle: { method: "mileage_rate", rateCentsPerMile: 76 },
  tiers: DEFAULT_TRAVEL_TIERS,
  localAreaMinutes: 20,
  maxTravelMinutes: 90,
  defaultPickupMinutes: 15,
  approximateLocationBufferMinutes: 5,
  wastedTripRateBps: 1_000,
  ownerHourlyValueCents: 2_500,
  minProfitPerHourOutsideLocalCents: 3_000,
};

export function vehicleCostPerMileCents(vehicle: VehicleCostMethod): number {
  if (vehicle.method === "mileage_rate") return vehicle.rateCentsPerMile;
  if (vehicle.milesPerGallon <= 0) throw new Error("milesPerGallon must be positive");
  return vehicle.fuelPriceCentsPerGallon / vehicle.milesPerGallon + vehicle.maintenanceCentsPerMile + vehicle.depreciationCentsPerMile;
}

export interface TravelCostBreakdown {
  status: "computed" | "provisional" | "unknown" | "not_required";
  oneWayMinutes: number | null;
  /** One-way minutes used for threshold selection (includes the approximate-location buffer). */
  oneWayMinutesForThreshold: number | null;
  roundTripMiles: number | null;
  roundTripMinutes: number | null;
  pickupMinutes: number;
  totalSourcingMinutes: number | null;
  vehicleCostCents: Cents;
  tollsCents: Cents;
  parkingCents: Cents;
  /** Expected cost of wasted trips (wasted-trip rate times the trip cost). */
  wastedTripAllowanceCents: Cents;
  /** Cash-like travel cost charged against the deal. Excludes the owner's time value. */
  totalTravelCostCents: Cents;
  /** Owner time value, reported separately and never added to operating costs. */
  ownerTimeValueCents: Cents | null;
  vehicleMethod: VehicleCostMethod["method"];
  notes: string[];
}

export function computeTravelCost(route: RouteEstimate, settings: TravelSettings, pickupMinutes?: number): TravelCostBreakdown {
  const pickup = pickupMinutes ?? settings.defaultPickupMinutes;
  const notes: string[] = [];

  if (route.source === "shipped") {
    return {
      status: "not_required",
      oneWayMinutes: 0,
      oneWayMinutesForThreshold: 0,
      roundTripMiles: 0,
      roundTripMinutes: 0,
      pickupMinutes: 0,
      totalSourcingMinutes: 0,
      vehicleCostCents: 0,
      tollsCents: 0,
      parkingCents: 0,
      wastedTripAllowanceCents: 0,
      totalTravelCostCents: 0,
      ownerTimeValueCents: 0,
      vehicleMethod: settings.vehicle.method,
      notes: ["Item ships to you. No pickup travel."],
    };
  }

  if (route.oneWayMinutes === null || route.oneWayMiles === null || route.source === "unknown") {
    return {
      status: "unknown",
      oneWayMinutes: null,
      oneWayMinutesForThreshold: null,
      roundTripMiles: null,
      roundTripMinutes: null,
      pickupMinutes: pickup,
      totalSourcingMinutes: null,
      vehicleCostCents: 0,
      tollsCents: 0,
      parkingCents: 0,
      wastedTripAllowanceCents: 0,
      totalTravelCostCents: 0,
      ownerTimeValueCents: null,
      vehicleMethod: settings.vehicle.method,
      notes: ["Drive time is unknown. Add the seller's area or a manual drive time before relying on travel economics."],
    };
  }

  const provisional = route.precision !== "exact";
  if (provisional) notes.push("Seller location is approximate, so drive time is provisional.");
  if (!route.trafficAware) notes.push("Drive time is not traffic-aware.");

  const roundTripMiles = route.oneWayMiles * 2;
  const roundTripMinutes = route.oneWayMinutes * 2;
  const vehicleCostCents = roundHalfAway(roundTripMiles * vehicleCostPerMileCents(settings.vehicle));
  const tripCost = vehicleCostCents + route.tollsCents + route.parkingCents;
  const wastedTripAllowanceCents = applyBps(tripCost, settings.wastedTripRateBps);
  const totalSourcingMinutes = roundTripMinutes + pickup;

  return {
    status: provisional ? "provisional" : "computed",
    oneWayMinutes: route.oneWayMinutes,
    oneWayMinutesForThreshold: route.oneWayMinutes + (provisional ? settings.approximateLocationBufferMinutes : 0),
    roundTripMiles,
    roundTripMinutes,
    pickupMinutes: pickup,
    totalSourcingMinutes,
    vehicleCostCents,
    tollsCents: route.tollsCents,
    parkingCents: route.parkingCents,
    wastedTripAllowanceCents,
    totalTravelCostCents: tripCost + wastedTripAllowanceCents,
    ownerTimeValueCents: roundHalfAway((totalSourcingMinutes / 60) * settings.ownerHourlyValueCents),
    vehicleMethod: settings.vehicle.method,
    notes,
  };
}

export function sortedTiers(tiers: readonly TravelTier[]): TravelTier[] {
  return [...tiers].sort((a, b) => (a.maxOneWayMinutes ?? Infinity) - (b.maxOneWayMinutes ?? Infinity));
}

export function tierForMinutes(minutes: number, tiers: readonly TravelTier[]): TravelTier {
  const ordered = sortedTiers(tiers);
  const tier = ordered.find((t) => t.maxOneWayMinutes === null || minutes <= t.maxOneWayMinutes);
  const last = ordered[ordered.length - 1];
  if (!tier && !last) throw new Error("No travel tiers configured");
  return (tier ?? last)!;
}

export interface TravelQualification {
  tier: TravelTier | null;
  requiredNetProfitCents: Cents | null;
  outsideLocalArea: boolean;
  beyondMaxTravel: boolean;
  requiresManualReview: boolean;
  provisional: boolean;
}

export function qualifyTravel(travel: TravelCostBreakdown, settings: TravelSettings): TravelQualification {
  const local = sortedTiers(settings.tiers)[0] ?? null;
  if (travel.status === "not_required") {
    return {
      tier: local,
      requiredNetProfitCents: local?.minNetProfitCents ?? null,
      outsideLocalArea: false,
      beyondMaxTravel: false,
      requiresManualReview: false,
      provisional: false,
    };
  }
  if (travel.oneWayMinutesForThreshold === null) {
    return { tier: null, requiredNetProfitCents: null, outsideLocalArea: false, beyondMaxTravel: false, requiresManualReview: false, provisional: true };
  }
  const minutes = travel.oneWayMinutesForThreshold;
  const tier = tierForMinutes(minutes, settings.tiers);
  return {
    tier,
    requiredNetProfitCents: tier.minNetProfitCents,
    outsideLocalArea: minutes > settings.localAreaMinutes,
    beyondMaxTravel: minutes > settings.maxTravelMinutes,
    requiresManualReview: tier.requiresManualReview,
    provisional: travel.status === "provisional",
  };
}
