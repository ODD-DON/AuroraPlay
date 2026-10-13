import type { Cents } from "./money";
import type { TravelTier } from "./travel";

/**
 * Geographic monitoring tiers. Close areas are polled often for everything;
 * wider rings are polled less often and only surface higher-value candidates.
 *
 * Search APIs filter by radius in miles, so each ring carries an approximate
 * mile radius used only to scope the query. Qualification always uses real
 * drive time from the routing provider, never this radius.
 */

export interface SearchRing {
  tierId: string;
  label: string;
  maxOneWayMinutes: number | null;
  approxRadiusMiles: number;
  pollEveryMinutes: number;
  /** Minimum asking-price-to-estimate gap worth spending analysis budget on. */
  minPotentialProfitCents: Cents;
}

/** Rough suburban Chicago drive speeds: about 0.75 miles per minute including local roads. */
export const MILES_PER_MINUTE_ESTIMATE = 0.75;

export function buildSearchRings(tiers: readonly TravelTier[], maxTravelMinutes: number): SearchRing[] {
  const poll = [15, 30, 60, 120, 240];
  return [...tiers]
    .sort((a, b) => (a.maxOneWayMinutes ?? Infinity) - (b.maxOneWayMinutes ?? Infinity))
    .map((t, i) => {
      const minutes = t.maxOneWayMinutes ?? maxTravelMinutes;
      return {
        tierId: t.id,
        label: t.label,
        maxOneWayMinutes: t.maxOneWayMinutes,
        approxRadiusMiles: Math.round(Math.min(minutes, maxTravelMinutes) * MILES_PER_MINUTE_ESTIMATE),
        pollEveryMinutes: poll[Math.min(i, poll.length - 1)]!,
        minPotentialProfitCents: t.minNetProfitCents,
      };
    });
}

export interface RingRunState {
  tierId: string;
  lastRunAt: string | null;
}

export function dueRings(rings: readonly SearchRing[], state: readonly RingRunState[], now: Date): SearchRing[] {
  return rings.filter((r) => {
    const last = state.find((s) => s.tierId === r.tierId)?.lastRunAt;
    if (!last) return true;
    return now.getTime() - new Date(last).getTime() >= r.pollEveryMinutes * 60_000;
  });
}

/** Cheap pre-filter before any paid analysis: does a listing in this ring have enough headroom to matter? */
export function worthAnalyzing(ring: SearchRing, askingCents: Cents, roughEstimateCents: Cents | null): boolean {
  if (roughEstimateCents === null) return ring.maxOneWayMinutes !== null && ring.maxOneWayMinutes <= 20;
  return roughEstimateCents - askingCents >= ring.minPotentialProfitCents;
}
