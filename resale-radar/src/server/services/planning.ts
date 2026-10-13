import "server-only";
import { z } from "zod";
import { planTrip, type TravelMatrix, type TripStop } from "@/domain/trips";
import { num, numOrNull, type Queryable } from "@/server/db";
import { audit, getSettings } from "./core";
import { getOpportunityDetail } from "./opportunities";

/* -------------------------------- watchlists -------------------------------- */

export const watchlistSchema = z.object({
  name: z.string().trim().min(2).max(120),
  active: z.boolean().default(true),
  sources: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  keywords: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  exclusions: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  minPriceCents: z.number().int().min(0).nullable().default(null),
  maxPriceCents: z.number().int().min(0).nullable().default(null),
  maxTravelMinutes: z.number().int().min(1).max(600).nullable().default(null),
  minRoiBps: z.number().int().min(0).nullable().default(null),
  minNetProfitCents: z.number().int().min(0).nullable().default(null),
  requiredEvidence: z.enum(["any", "thin", "moderate", "strong"]).default("moderate"),
  pollMinutes: z.number().int().min(5).max(1440).default(60),
});
export type WatchlistInput = z.input<typeof watchlistSchema>;

export async function saveWatchlist(q: Queryable, ownerId: string, raw: WatchlistInput, id?: string) {
  const w = watchlistSchema.parse(raw);
  const params = [ownerId, w.name, w.active, w.sources, w.categories, w.keywords, w.exclusions, w.minPriceCents, w.maxPriceCents, w.maxTravelMinutes, w.minRoiBps, w.minNetProfitCents, w.requiredEvidence, w.pollMinutes];
  if (id) {
    await q.query(
      `update search_profiles set name=$2, active=$3, sources=$4, categories=$5, keywords=$6, exclusions=$7, min_price_cents=$8, max_price_cents=$9,
         max_travel_minutes=$10, min_roi_bps=$11, min_net_profit_cents=$12, required_evidence=$13, poll_minutes=$14, updated_at=now()
       where id=$15 and owner_id=$1`,
      [...params, id],
    );
    return id;
  }
  const [row] = await q.query<{ id: string }>(
    `insert into search_profiles (owner_id, name, active, sources, categories, keywords, exclusions, min_price_cents, max_price_cents, max_travel_minutes,
       min_roi_bps, min_net_profit_cents, required_evidence, poll_minutes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
    params,
  );
  await audit(q, ownerId, "watchlist.created", "search_profile", row!.id, { name: w.name });
  return row!.id;
}

export async function listWatchlists(q: Queryable, ownerId: string) {
  const rows = await q.query<Record<string, unknown>>(
    `select p.*, (select max(started_at) from search_executions e where e.search_profile_id = p.id) as last_run,
            (select count(*) from search_executions e where e.search_profile_id = p.id and e.status = 'succeeded') as runs
       from search_profiles p where p.owner_id = $1 order by p.active desc, p.created_at desc`,
    [ownerId],
  );
  return rows.map((r) => ({
    id: String(r.id), name: String(r.name), active: !!r.active, sources: (r.sources as string[]) ?? [], categories: (r.categories as string[]) ?? [],
    keywords: (r.keywords as string[]) ?? [], exclusions: (r.exclusions as string[]) ?? [], minPriceCents: numOrNull(r.min_price_cents), maxPriceCents: numOrNull(r.max_price_cents),
    maxTravelMinutes: numOrNull(r.max_travel_minutes), minRoiBps: numOrNull(r.min_roi_bps), minNetProfitCents: numOrNull(r.min_net_profit_cents),
    requiredEvidence: String(r.required_evidence), pollMinutes: num(r.poll_minutes), lastRun: (r.last_run as Date) ?? null, runs: num(r.runs),
  }));
}

export async function deleteWatchlist(q: Queryable, ownerId: string, id: string) {
  await q.query(`delete from search_profiles where id = $1 and owner_id = $2`, [id, ownerId]);
}

/* ---------------------------------- trips ---------------------------------- */

export const tripLegSchema = z.object({ minutes: z.number().int().min(0).max(600), miles: z.number().min(0).max(600) });

/**
 * Plans a multi-stop pickup trip. Home-to-stop legs come from each deal's recorded route.
 * Stop-to-stop legs come from the routing provider when configured, otherwise from the owner.
 * Straight-line distance is never used as a drive-time substitute.
 */
export async function planPickupTrip(
  q: Queryable,
  ownerId: string,
  opportunityIds: string[],
  interStopLegs: Record<string, z.infer<typeof tripLegSchema>>,
  name: string,
) {
  if (opportunityIds.length < 1 || opportunityIds.length > 7) throw new Error("Choose between 1 and 7 deals for a trip.");
  const { settings } = await getSettings(q, ownerId);
  const stops: TripStop[] = [];
  const homeLegs: { minutes: number; miles: number }[] = [];
  for (const id of opportunityIds) {
    const d = await getOpportunityDetail(q, ownerId, id);
    if (!d) throw new Error("Deal not found");
    if (!d.route || d.route.oneWayMinutes === null || d.route.oneWayMiles === null || d.route.source === "shipped") {
      throw new Error(`"${d.opportunity.title}" has no drive time recorded.`);
    }
    const base = d.evaluation?.scenariosAtAsking?.find((s) => s.name === "conservative")?.result;
    stops.push({
      id,
      label: d.opportunity.title,
      pickupMinutes: d.opportunity.pickup_minutes ?? settings.travel.defaultPickupMinutes,
      tollsCents: d.route.tollsCents,
      parkingCents: d.route.parkingCents,
      netBeforeTravelCents: base ? base.netProfitCents + base.travelCostCents : 0,
    });
    homeLegs.push({ minutes: d.route.oneWayMinutes, miles: d.route.oneWayMiles });
  }
  const n = stops.length + 1;
  const matrix: TravelMatrix = { minutes: Array.from({ length: n }, () => Array(n).fill(0)), miles: Array.from({ length: n }, () => Array(n).fill(0)) };
  const missing: string[] = [];
  for (let i = 1; i < n; i++) {
    matrix.minutes[0]![i] = matrix.minutes[i]![0] = homeLegs[i - 1]!.minutes;
    matrix.miles[0]![i] = matrix.miles[i]![0] = homeLegs[i - 1]!.miles;
    for (let j = i + 1; j < n; j++) {
      const key = [stops[i - 1]!.id, stops[j - 1]!.id].sort().join(":");
      const leg = interStopLegs[key];
      if (!leg) {
        missing.push(key);
        continue;
      }
      matrix.minutes[i]![j] = matrix.minutes[j]![i] = leg.minutes;
      matrix.miles[i]![j] = matrix.miles[j]![i] = leg.miles;
    }
  }
  if (missing.length) return { status: "needs_legs" as const, missing, stops: stops.map((s) => ({ id: s.id, label: s.label })) };

  const plan = planTrip(stops, matrix, settings.travel);
  const [trip] = await q.query<{ id: string }>(
    `insert into pickup_trips (owner_id, name, status, total_minutes, total_miles, trip_cost_cents, plan) values ($1,$2,'planned',$3,$4,$5,$6) returning id`,
    [ownerId, name, plan.totalMinutes, plan.totalMiles, plan.tripCostCents, plan],
  );
  for (const [idx, stopId] of plan.order.entries()) {
    const alloc = plan.allocations.find((a) => a.stopId === stopId)!;
    const [neg] = await q.query<{ agreed_price_cents: number | null; max_price_cents: number | null }>(`select agreed_price_cents, max_price_cents from negotiations where opportunity_id = $1`, [stopId]);
    await q.query(
      `insert into pickup_trip_stops (owner_id, trip_id, opportunity_id, sequence, allocated_cost_cents, cash_needed_cents) values ($1,$2,$3,$4,$5,$6)`,
      [ownerId, trip!.id, stopId, idx + 1, alloc.allocatedCostCents, neg ? numOrNull(neg.agreed_price_cents) ?? numOrNull(neg.max_price_cents) : null],
    );
  }
  await audit(q, ownerId, "trip.planned", "pickup_trip", trip!.id, { stops: plan.order.length });
  return { status: "planned" as const, tripId: trip!.id, plan };
}

export async function listTrips(q: Queryable, ownerId: string) {
  const trips = await q.query<Record<string, unknown>>(`select * from pickup_trips where owner_id = $1 order by created_at desc limit 50`, [ownerId]);
  const out = [];
  for (const t of trips) {
    const stops = await q.query<Record<string, unknown>>(
      `select s.*, o.title from pickup_trip_stops s join opportunities o on o.id = s.opportunity_id where s.trip_id = $1 order by s.sequence`,
      [t.id],
    );
    out.push({
      id: String(t.id), name: String(t.name), status: String(t.status), totalMinutes: numOrNull(t.total_minutes), totalMiles: numOrNull(t.total_miles),
      tripCostCents: numOrNull(t.trip_cost_cents), plan: t.plan as ReturnType<typeof planTrip> | null, createdAt: t.created_at as Date,
      stops: stops.map((s) => ({ opportunityId: String(s.opportunity_id), title: String(s.title), sequence: numOrNull(s.sequence), allocatedCostCents: numOrNull(s.allocated_cost_cents), cashNeededCents: numOrNull(s.cash_needed_cents), status: String(s.status) })),
    });
  }
  return out;
}

/* -------------------------------- analytics -------------------------------- */

export async function getAnalytics(q: Queryable, ownerId: string) {
  const [sourcing] = await q.query<Record<string, unknown>>(
    `select count(*) as discovered,
            count(*) filter (where decision in ('STRONG_BUY','WORTH_THE_DRIVE','BUY_IF_NEGOTIATED')) as qualified,
            count(*) filter (where decision = 'STRONG_BUY') as strong_buy,
            count(*) filter (where decision = 'WORTH_THE_DRIVE') as worth_drive,
            count(*) filter (where decision = 'HIDDEN_GEM') as hidden_gem,
            count(*) filter (where status in ('purchased','listed','sold')) as purchased,
            count(*) filter (where status = 'sold_by_other') as missed
       from opportunities where owner_id = $1`,
    [ownerId],
  );
  const [offers] = await q.query<Record<string, unknown>>(
    `select count(*) as offers_made,
            count(*) filter (where n.status = 'agreed') as accepted,
            count(*) filter (where n.status in ('declined','sold_elsewhere')) as rejected,
            avg(case when n.agreed_price_cents is not null and o.asking_price_cents > 0 then 1 - n.agreed_price_cents::float / o.asking_price_cents end) as avg_discount
       from negotiations n join opportunities o on o.id = n.opportunity_id where n.owner_id = $1 and n.status <> 'not_started'`,
    [ownerId],
  );
  const [sales] = await q.query<Record<string, unknown>>(
    `select count(*) as units, coalesce(sum(actual_proceeds_cents),0) as revenue, coalesce(sum(actual_profit_cents),0) as profit,
            avg(actual_profit_cents::float / nullif(cost_basis_cents,0)) as avg_roi,
            percentile_cont(0.5) within group (order by extract(epoch from (sold_at - purchase_date::timestamptz)) / 86400) as median_days,
            count(*) filter (where actual_profit_cents < 0) as losses
       from inventory_items where owner_id = $1 and sold_at is not null`,
    [ownerId],
  );
  const byCategory = await q.query<Record<string, unknown>>(
    `select coalesce(category,'other') as category, count(*) as units, coalesce(sum(actual_profit_cents),0) as profit,
            avg(actual_profit_cents::float / nullif(cost_basis_cents,0)) as roi
       from inventory_items where owner_id = $1 and sold_at is not null group by 1 order by profit desc`,
    [ownerId],
  );
  const accuracy = await q.query<Record<string, unknown>>(
    `select i.name, i.actual_proceeds_cents, mv.base_cents as predicted_cents, i.actual_profit_cents, o.base_net_cents as predicted_profit_cents,
            extract(epoch from (i.sold_at - i.purchase_date::timestamptz)) / 86400 as actual_days
       from inventory_items i join opportunities o on o.id = i.opportunity_id
       left join lateral (select base_cents from market_valuations m where m.opportunity_id = o.id order by version desc limit 1) mv on true
      where i.owner_id = $1 and i.sold_at is not null order by i.sold_at desc limit 50`,
    [ownerId],
  );
  const [ai] = await q.query<Record<string, unknown>>(
    `select count(*) filter (where kind = 'correct') as correct, count(*) filter (where kind in ('incorrect','corrected')) as incorrect,
            count(*) filter (where kind = 'false_positive_deal') as false_positive from ai_feedback where owner_id = $1`,
    [ownerId],
  );
  const monthly = await q.query<Record<string, unknown>>(
    `select to_char(date_trunc('month', sold_at), 'YYYY-MM') as month, coalesce(sum(actual_profit_cents),0) as profit, count(*) as units
       from inventory_items where owner_id = $1 and sold_at is not null group by 1 order by 1`,
    [ownerId],
  );
  const shipping = await q.query<Record<string, unknown>>(
    `select avg(s.label_cost_cents - o2.shipping_label_cents) as avg_error
       from shipments s join order_items oi on oi.order_id = s.order_id join inventory_items i on i.id = oi.inventory_item_id
       join opportunities o2 on o2.id = i.opportunity_id where s.owner_id = $1 and o2.shipping_label_cents > 0`,
    [ownerId],
  );
  return {
    sourcing: Object.fromEntries(Object.entries(sourcing ?? {}).map(([k, v]) => [k, num(v)])) as Record<string, number>,
    offers: { made: num(offers?.offers_made), accepted: num(offers?.accepted), rejected: num(offers?.rejected), avgDiscount: offers?.avg_discount == null ? null : Number(offers.avg_discount) },
    sales: {
      units: num(sales?.units), revenueCents: num(sales?.revenue), profitCents: num(sales?.profit), avgRoi: sales?.avg_roi == null ? null : Number(sales.avg_roi),
      medianDays: sales?.median_days == null ? null : Math.round(Number(sales.median_days)), losses: num(sales?.losses),
    },
    byCategory: byCategory.map((r) => ({ category: String(r.category), units: num(r.units), profitCents: num(r.profit), roi: r.roi == null ? null : Number(r.roi) })),
    accuracy: accuracy.map((r) => ({
      name: String(r.name), actualCents: numOrNull(r.actual_proceeds_cents), predictedCents: numOrNull(r.predicted_cents),
      actualProfitCents: numOrNull(r.actual_profit_cents), predictedProfitCents: numOrNull(r.predicted_profit_cents), actualDays: r.actual_days == null ? null : Math.round(Number(r.actual_days)),
    })),
    ai: { correct: num(ai?.correct), incorrect: num(ai?.incorrect), falsePositive: num(ai?.false_positive) },
    monthly: monthly.map((r) => ({ month: String(r.month), profitCents: num(r.profit), units: num(r.units) })),
    shippingErrorCents: shipping[0]?.avg_error == null ? null : Math.round(Number(shipping[0].avg_error)),
  };
}
