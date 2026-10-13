import { applyBps, roundHalfAway, type Cents } from "./money";
import { vehicleCostPerMileCents, type TravelSettings } from "./travel";

/**
 * Multi-stop pickup planning.
 *
 * Node 0 is home. The route visits every stop and returns home. Shared trip
 * cost is allocated to each stop in proportion to what that stop would have
 * cost as a standalone round trip, so a stop never pays more than it would alone.
 */

export interface TripStop {
  id: string;
  label: string;
  pickupMinutes: number;
  /** Optional time window in minutes after departure. */
  windowStartMin?: number | null;
  windowEndMin?: number | null;
  tollsCents?: Cents;
  parkingCents?: Cents;
  /** Expected net profit of the item before travel costs. */
  netBeforeTravelCents: Cents;
}

/** Driving matrix, index 0 = home, i = stops[i-1]. */
export interface TravelMatrix {
  minutes: number[][];
  miles: number[][];
}

export interface StopAllocation {
  stopId: string;
  standaloneCostCents: Cents;
  allocatedCostCents: Cents;
  netAfterTravelCents: Cents;
  arrivalMinute: number;
}

export interface TripPlan {
  order: string[];
  totalMinutes: number;
  totalMiles: number;
  driveMinutes: number;
  tripCostCents: Cents;
  feasible: boolean;
  allocations: StopAllocation[];
  combinedNetCents: Cents;
  savingsVsSeparateCents: Cents;
  notes: string[];
}

function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  const out: number[][] = [];
  const rec = (prefix: number[], rest: number[]) => {
    if (!rest.length) return void out.push(prefix);
    rest.forEach((v, i) => rec([...prefix, v], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  rec([], Array.from({ length: n }, (_, i) => i + 1));
  return out;
}

export function planTrip(stops: readonly TripStop[], matrix: TravelMatrix, settings: TravelSettings): TripPlan {
  if (stops.length === 0) throw new Error("A trip needs at least one stop");
  if (stops.length > 7) throw new Error("Trips are limited to 7 stops");
  const perMile = vehicleCostPerMileCents(settings.vehicle);
  const fixed = stops.reduce((a, s) => a + (s.tollsCents ?? 0) + (s.parkingCents ?? 0), 0);
  const notes: string[] = [];

  let best: { order: number[]; minutes: number; miles: number; drive: number; arrivals: number[]; feasible: boolean } | null = null;
  for (const perm of permutations(stops.length)) {
    let t = 0, miles = 0, drive = 0, prev = 0, feasible = true;
    const arrivals: number[] = [];
    for (const node of perm) {
      const stop = stops[node - 1]!;
      drive += matrix.minutes[prev]![node]!;
      t += matrix.minutes[prev]![node]!;
      miles += matrix.miles[prev]![node]!;
      if (stop.windowStartMin != null && t < stop.windowStartMin) t = stop.windowStartMin;
      if (stop.windowEndMin != null && t > stop.windowEndMin) feasible = false;
      arrivals.push(t);
      t += stop.pickupMinutes;
      prev = node;
    }
    drive += matrix.minutes[prev]![0]!;
    t += matrix.minutes[prev]![0]!;
    miles += matrix.miles[prev]![0]!;
    const candidate = { order: perm, minutes: t, miles, drive, arrivals, feasible };
    if (!best || (candidate.feasible && !best.feasible) || (candidate.feasible === best.feasible && candidate.minutes < best.minutes)) best = candidate;
  }
  const b = best!;
  if (!b.feasible) notes.push("No order satisfies every seller time window. Confirm times with sellers.");

  const vehicleCost = roundHalfAway(b.miles * perMile);
  const tripBase = vehicleCost + fixed;
  const tripCostCents = tripBase + applyBps(tripBase, settings.wastedTripRateBps);

  const standalone = stops.map((s, i) => {
    const m = matrix.miles[0]![i + 1]! + matrix.miles[i + 1]![0]!;
    const base = roundHalfAway(m * perMile) + (s.tollsCents ?? 0) + (s.parkingCents ?? 0);
    return base + applyBps(base, settings.wastedTripRateBps);
  });
  const standaloneTotal = standalone.reduce((a, v) => a + v, 0);

  // Proportional allocation with largest-remainder rounding so allocations sum exactly to the trip cost.
  const raw = standalone.map((v) => (standaloneTotal ? (v * tripCostCents) / standaloneTotal : tripCostCents / stops.length));
  const floors = raw.map(Math.floor);
  let remainder = tripCostCents - floors.reduce((a, v) => a + v, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((x, y) => y.frac - x.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i]! += 1;
    remainder -= 1;
  }

  const arrivalById = new Map(b.order.map((node, k) => [stops[node - 1]!.id, b.arrivals[k]!]));
  const allocations: StopAllocation[] = stops.map((s, i) => ({
    stopId: s.id,
    standaloneCostCents: standalone[i]!,
    allocatedCostCents: floors[i]!,
    netAfterTravelCents: s.netBeforeTravelCents - floors[i]!,
    arrivalMinute: arrivalById.get(s.id) ?? 0,
  }));

  return {
    order: b.order.map((n) => stops[n - 1]!.id),
    totalMinutes: b.minutes,
    totalMiles: roundHalfAway(b.miles * 10) / 10,
    driveMinutes: b.drive,
    tripCostCents,
    feasible: b.feasible,
    allocations,
    combinedNetCents: allocations.reduce((a, x) => a + x.netAfterTravelCents, 0),
    savingsVsSeparateCents: standaloneTotal - tripCostCents,
    notes,
  };
}
