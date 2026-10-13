import { dollarsToCents } from "@/domain/money";
import type { ImportListingInput } from "@/server/services/opportunities";
import { fetchWithRetry, IntegrationError } from "./http";

/**
 * eBay Browse API adapter (application token, client-credentials grant).
 * Returns ACTIVE listings only. Active prices are never used as sold comparables.
 */

const API = process.env.EBAY_ENV === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";

type TokenCache = { token: string; expiresAt: number } | null;
const g = globalThis as { __rrEbayToken?: TokenCache };

export function ebayConfigured(): boolean {
  return !!process.env.EBAY_CLIENT_ID && !!process.env.EBAY_CLIENT_SECRET;
}

async function appToken(): Promise<string> {
  if (g.__rrEbayToken && g.__rrEbayToken.expiresAt > Date.now() + 60_000) return g.__rrEbayToken.token;
  if (!ebayConfigured()) throw new IntegrationError("ebay_browse", "EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are not configured");
  const basic = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64");
  const res = await fetchWithRetry("ebay_browse", `${API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }).toString(),
  });
  const json = (await res.json()) as { access_token: string; expires_in: number };
  g.__rrEbayToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

export interface BrowseQuery {
  keywords: string;
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
  /** Restrict to items available for local pickup near this postal code. */
  pickupPostalCode?: string | null;
  pickupRadiusMiles?: number | null;
  conditions?: ("NEW" | "USED" | "UNSPECIFIED")[];
  limit?: number;
}

interface BrowseItem {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  condition?: string;
  itemWebUrl?: string;
  image?: { imageUrl: string };
  seller?: { username?: string; feedbackPercentage?: string; feedbackScore?: number };
  itemLocation?: { city?: string; stateOrProvince?: string; postalCode?: string };
  shippingOptions?: { shippingCost?: { value: string } }[];
  itemCreationDate?: string;
  categories?: { categoryName: string }[];
}

function buildFilter(q: BrowseQuery): string {
  const parts = ["deliveryCountry:US", "priceCurrency:USD", "buyingOptions:{FIXED_PRICE|BEST_OFFER}"];
  if (q.minPriceCents != null || q.maxPriceCents != null) {
    parts.push(`price:[${q.minPriceCents != null ? (q.minPriceCents / 100).toFixed(2) : ""}..${q.maxPriceCents != null ? (q.maxPriceCents / 100).toFixed(2) : ""}]`);
  }
  if (q.pickupPostalCode && q.pickupRadiusMiles) {
    parts.push("pickupCountry:US", `pickupPostalCode:${q.pickupPostalCode}`, `pickupRadius:${Math.round(q.pickupRadiusMiles)}`, "pickupRadiusUnit:mi");
  }
  if (q.conditions?.length) parts.push(`conditions:{${q.conditions.join("|")}}`);
  return parts.join(",");
}

export async function searchActive(q: BrowseQuery): Promise<{ total: number; items: ImportListingInput[] }> {
  const token = await appToken();
  const params = new URLSearchParams({ q: q.keywords.slice(0, 100), filter: buildFilter(q), limit: String(Math.min(q.limit ?? 50, 200)) });
  const res = await fetchWithRetry("ebay_browse", `${API}/buy/browse/v1/item_summary/search?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      ...(q.pickupPostalCode ? { "X-EBAY-C-ENDUSERCTX": `contextualLocation=country=US,zip=${q.pickupPostalCode}` } : {}),
    },
  });
  const json = (await res.json()) as { total?: number; itemSummaries?: BrowseItem[] };
  const items = (json.itemSummaries ?? [])
    .filter((i) => i.price?.currency === "USD")
    .map<ImportListingInput>((i) => ({
      url: i.itemWebUrl ?? null,
      externalId: i.itemId,
      source: "ebay",
      title: i.title,
      askingPriceCents: dollarsToCents(i.price!.value),
      condition: i.condition ?? null,
      sellerName: i.seller?.username ?? null,
      locationText: [i.itemLocation?.city, i.itemLocation?.stateOrProvince, i.itemLocation?.postalCode].filter(Boolean).join(", ") || null,
      locationPrecision: i.itemLocation?.postalCode ? "approximate" : "unknown",
      importMethod: "api",
      shippingAvailable: (i.shippingOptions?.length ?? 0) > 0,
      raw: { image: i.image?.imageUrl ?? null, seller: i.seller ?? null, created: i.itemCreationDate ?? null, category: i.categories?.[0]?.categoryName ?? null },
    }));
  return { total: json.total ?? items.length, items };
}

/** Count of comparable ACTIVE listings, used as the denominator of the sold-to-active ratio. */
export async function countActiveListings(keywords: string): Promise<number> {
  const token = await appToken();
  const params = new URLSearchParams({ q: keywords.slice(0, 100), filter: "deliveryCountry:US,priceCurrency:USD", limit: "1" });
  const res = await fetchWithRetry("ebay_browse", `${API}/buy/browse/v1/item_summary/search?${params}`, {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
  });
  return ((await res.json()) as { total?: number }).total ?? 0;
}
