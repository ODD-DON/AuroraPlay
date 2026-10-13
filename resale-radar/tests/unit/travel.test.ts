import { describe, expect, it } from "vitest";
import { computeTravelCost, DEFAULT_TRAVEL_SETTINGS, qualifyTravel, tierForMinutes, vehicleCostPerMileCents, type RouteEstimate } from "@/domain/travel";
import { planTrip } from "@/domain/trips";
import { buildSearchRings, dueRings, worthAnalyzing } from "@/domain/searchTiers";

const route = (min: number, miles: number, precision: RouteEstimate["precision"] = "exact"): RouteEstimate => ({
  source: "google_routes",
  precision,
  trafficAware: true,
  oneWayMinutes: min,
  oneWayMiles: miles,
  tollsCents: 0,
  parkingCents: 0,
  computedAt: "2026-10-13T12:00:00Z",
});

describe("travel tiers", () => {
  it.each([
    [5, "local", 6_000],
    [20, "local", 6_000],
    [21, "near", 10_000],
    [30, "near", 10_000],
    [31, "regional", 17_500],
    [45, "regional", 17_500],
    [46, "far", 30_000],
    [60, "far", 30_000],
    [61, "extended", 50_000],
  ])("%i minutes -> %s requires %i cents", (minutes, id, cents) => {
    const t = tierForMinutes(minutes, DEFAULT_TRAVEL_SETTINGS.tiers);
    expect(t.id).toBe(id);
    expect(t.minNetProfitCents).toBe(cents);
  });

  it("flags over-60-minute trips for manual review", () => {
    const q = qualifyTravel(computeTravelCost(route(70, 55), DEFAULT_TRAVEL_SETTINGS), DEFAULT_TRAVEL_SETTINGS);
    expect(q.requiresManualReview).toBe(true);
    expect(q.outsideLocalArea).toBe(true);
  });

  it("uses a conservative buffer for approximate locations", () => {
    const travel = computeTravelCost(route(28, 20, "approximate"), DEFAULT_TRAVEL_SETTINGS);
    expect(travel.status).toBe("provisional");
    expect(qualifyTravel(travel, DEFAULT_TRAVEL_SETTINGS).tier?.id).toBe("regional");
  });
});

describe("travel cost", () => {
  it("mileage method includes vehicle costs once; tolls and parking are added separately", () => {
    const t = computeTravelCost({ ...route(30, 20), tollsCents: 300, parkingCents: 200 }, DEFAULT_TRAVEL_SETTINGS);
    expect(t.roundTripMiles).toBe(40);
    expect(t.roundTripMinutes).toBe(60);
    expect(t.vehicleCostCents).toBe(3_040);
    expect(t.wastedTripAllowanceCents).toBe(354); // 10% of (3040 + 300 + 200)
    expect(t.totalTravelCostCents).toBe(3_040 + 500 + 354);
    expect(t.totalSourcingMinutes).toBe(75);
  });

  it("actual-expense method sums fuel, maintenance, and depreciation without the mileage rate", () => {
    const vehicle = { method: "actual_expense" as const, fuelPriceCentsPerGallon: 350, milesPerGallon: 25, maintenanceCentsPerMile: 10, depreciationCentsPerMile: 15 };
    expect(vehicleCostPerMileCents(vehicle)).toBe(39);
    const t = computeTravelCost(route(30, 20), { ...DEFAULT_TRAVEL_SETTINGS, vehicle });
    expect(t.vehicleCostCents).toBe(1_560);
  });

  it("never adds the owner's time value to operating travel cost", () => {
    const t = computeTravelCost(route(30, 20), DEFAULT_TRAVEL_SETTINGS);
    expect(t.ownerTimeValueCents).toBe(3_125); // 75 min at $25/hr
    expect(t.totalTravelCostCents).toBe(3_040 + 304);
  });

  it("reports unknown travel instead of guessing", () => {
    const t = computeTravelCost({ ...route(0, 0), source: "unknown", oneWayMinutes: null, oneWayMiles: null }, DEFAULT_TRAVEL_SETTINGS);
    expect(t.status).toBe("unknown");
    expect(qualifyTravel(t, DEFAULT_TRAVEL_SETTINGS).requiredNetProfitCents).toBeNull();
  });

  it("shipped purchases have no travel and use the local threshold", () => {
    const t = computeTravelCost({ ...route(0, 0), source: "shipped" }, DEFAULT_TRAVEL_SETTINGS);
    expect(t.totalTravelCostCents).toBe(0);
    expect(qualifyTravel(t, DEFAULT_TRAVEL_SETTINGS).requiredNetProfitCents).toBe(6_000);
  });
});

describe("multi-stop trips", () => {
  const matrix = {
    // home, A, B
    minutes: [
      [0, 30, 35],
      [30, 0, 10],
      [35, 10, 0],
    ],
    miles: [
      [0, 20, 24],
      [20, 0, 6],
      [24, 6, 0],
    ],
  };
  const stops = [
    { id: "A", label: "A", pickupMinutes: 15, netBeforeTravelCents: 20_000 },
    { id: "B", label: "B", pickupMinutes: 15, netBeforeTravelCents: 25_000 },
  ];

  it("finds the shortest order and allocates shared cost exactly", () => {
    const plan = planTrip(stops, matrix, DEFAULT_TRAVEL_SETTINGS);
    expect(plan.totalMiles).toBe(50);
    expect(plan.driveMinutes).toBe(75);
    expect(plan.totalMinutes).toBe(105);
    const total = plan.allocations.reduce((a, x) => a + x.allocatedCostCents, 0);
    expect(total).toBe(plan.tripCostCents);
    for (const a of plan.allocations) expect(a.allocatedCostCents).toBeLessThanOrEqual(a.standaloneCostCents);
    expect(plan.savingsVsSeparateCents).toBeGreaterThan(0);
  });

  it("respects seller time windows", () => {
    const plan = planTrip([{ ...stops[0]!, windowStartMin: 60 }, stops[1]!], matrix, DEFAULT_TRAVEL_SETTINGS);
    expect(plan.order).toEqual(["B", "A"]);
    expect(plan.feasible).toBe(true);
  });
});

describe("search tiers", () => {
  const rings = buildSearchRings(DEFAULT_TRAVEL_SETTINGS.tiers, DEFAULT_TRAVEL_SETTINGS.maxTravelMinutes);
  it("polls close rings more often than wide rings", () => {
    expect(rings[0]!.pollEveryMinutes).toBeLessThan(rings[rings.length - 1]!.pollEveryMinutes);
    expect(rings[rings.length - 1]!.approxRadiusMiles).toBeLessThanOrEqual(Math.round(90 * 0.75));
  });
  it("schedules only due rings", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    const due = dueRings(rings, [{ tierId: "local", lastRunAt: "2026-10-13T11:50:00Z" }, { tierId: "near", lastRunAt: "2026-10-13T11:00:00Z" }], now);
    expect(due.map((r) => r.tierId)).not.toContain("local");
    expect(due.map((r) => r.tierId)).toContain("near");
  });
  it("skips paid analysis for far listings without enough headroom", () => {
    const far = rings.find((r) => r.tierId === "far")!;
    expect(worthAnalyzing(far, 10_000, 30_000)).toBe(false);
    expect(worthAnalyzing(far, 4_000, 50_000)).toBe(true);
  });
});
