import { fetchWithRetry, IntegrationError } from "./http";

/**
 * Google Maps Routes API adapter (v2). Server-side only.
 * Field masks keep responses small and billing on the cheapest SKU that has what we need.
 */

export interface RoutePoint {
  address?: string;
  latitude?: number;
  longitude?: number;
}

export interface RouteResult {
  oneWayMinutes: number;
  oneWayMiles: number;
  tollsCents: number;
  trafficAware: boolean;
  raw: unknown;
}

const METERS_PER_MILE = 1609.344;

function waypoint(p: RoutePoint) {
  if (p.latitude != null && p.longitude != null) return { location: { latLng: { latitude: p.latitude, longitude: p.longitude } } };
  if (p.address) return { address: p.address };
  throw new IntegrationError("google_routes", "A route point needs an address or coordinates");
}

function parseDurationSeconds(d: unknown): number {
  const m = typeof d === "string" ? d.match(/^(\d+(?:\.\d+)?)s$/) : null;
  if (!m) throw new IntegrationError("google_routes", "Unexpected duration format");
  return Number(m[1]);
}

function moneyToCents(m: { currencyCode?: string; units?: string; nanos?: number } | undefined): number {
  if (!m || (m.currencyCode && m.currencyCode !== "USD")) return 0;
  return Number(m.units ?? 0) * 100 + Math.round((m.nanos ?? 0) / 10_000_000);
}

export function routingConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

/** Approximate per-request cost in microdollars for usage tracking (traffic-aware with tolls). Confirm in Google Cloud billing. */
export const ROUTE_COST_MICRODOLLARS = 15_000;

export async function computeRoute(origin: RoutePoint, destination: RoutePoint, opts: { tolls?: boolean } = {}): Promise<RouteResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new IntegrationError("google_routes", "GOOGLE_MAPS_API_KEY is not configured");
  const res = await fetchWithRetry("google_routes", "https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.travelAdvisory.tollInfo",
    },
    body: JSON.stringify({
      origin: waypoint(origin),
      destination: waypoint(destination),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      ...(opts.tolls !== false ? { extraComputations: ["TOLLS"], routeModifiers: { vehicleInfo: { emissionType: "GASOLINE" } } } : {}),
      units: "IMPERIAL",
    }),
  });
  const json = (await res.json()) as { routes?: { duration?: string; distanceMeters?: number; travelAdvisory?: { tollInfo?: { estimatedPrice?: { currencyCode?: string; units?: string; nanos?: number }[] } } }[] };
  const route = json.routes?.[0];
  if (!route || route.distanceMeters == null || !route.duration) throw new IntegrationError("google_routes", "No drivable route found for that location");
  return {
    oneWayMinutes: Math.round(parseDurationSeconds(route.duration) / 60),
    oneWayMiles: Math.round((route.distanceMeters / METERS_PER_MILE) * 10) / 10,
    tollsCents: moneyToCents(route.travelAdvisory?.tollInfo?.estimatedPrice?.[0]),
    trafficAware: true,
    raw: json,
  };
}

/** Pairwise legs between stops for multi-stop trip optimization. */
export async function computeLegMatrix(points: RoutePoint[]): Promise<{ minutes: number[][]; miles: number[][] }> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new IntegrationError("google_routes", "GOOGLE_MAPS_API_KEY is not configured");
  const res = await fetchWithRetry("google_routes", "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition" },
    body: JSON.stringify({
      origins: points.map((p) => ({ waypoint: waypoint(p) })),
      destinations: points.map((p) => ({ waypoint: waypoint(p) })),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
    }),
  });
  const rows = (await res.json()) as { originIndex: number; destinationIndex: number; duration?: string; distanceMeters?: number; condition?: string }[];
  const n = points.length;
  const minutes = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const miles = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (const r of rows) {
    if (r.originIndex === r.destinationIndex) continue;
    if (r.condition !== "ROUTE_EXISTS" || !r.duration || r.distanceMeters == null) throw new IntegrationError("google_routes", "A leg between stops has no route");
    minutes[r.originIndex]![r.destinationIndex] = Math.round(parseDurationSeconds(r.duration) / 60);
    miles[r.originIndex]![r.destinationIndex] = Math.round((r.distanceMeters / METERS_PER_MILE) * 10) / 10;
  }
  return { minutes, miles };
}
