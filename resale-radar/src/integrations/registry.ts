/**
 * Integration registry. Capabilities reflect docs/integration-feasibility.md
 * (verified 2026-10-13). "configured" only means credentials are present;
 * an integration is reported working only after a successful live call.
 */

export type Access = "official" | "restricted" | "paid" | "unavailable" | "manual";

export interface IntegrationDescriptor {
  id: string;
  name: string;
  category: "sourcing" | "sold_data" | "selling" | "ai" | "routing" | "notifications" | "shipping" | "reference";
  access: Access;
  summary: string;
  envVars: string[];
  capabilities: { label: string; supported: boolean; note?: string }[];
  decision: string;
  docsUrl: string;
}

export const INTEGRATIONS: IntegrationDescriptor[] = [
  {
    id: "facebook_marketplace",
    name: "Facebook Marketplace",
    category: "sourcing",
    access: "manual",
    summary: "No official API exists for reading other sellers' listings, messaging, or offers. Automated collection is prohibited by Meta's terms.",
    envVars: [],
    capabilities: [
      { label: "Search listings", supported: false, note: "Not available through any authorized API" },
      { label: "Messaging", supported: false },
      { label: "Import by URL, share sheet, or screenshot", supported: true, note: "Implemented" },
    ],
    decision: "Manual workflow: paste URL, share to the app, or upload a screenshot for AI extraction. Messages are drafted for you to send.",
    docsUrl: "https://www.facebook.com/terms",
  },
  {
    id: "ebay_browse",
    name: "eBay Browse API",
    category: "sourcing",
    access: "official",
    summary: "Active eBay listings with price, condition, images, and local pickup filters. No sold data. Default 5,000 calls per day.",
    envVars: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
    capabilities: [
      { label: "Search active listings", supported: true },
      { label: "Local pickup radius filter", supported: true },
      { label: "Active competition count", supported: true },
      { label: "Sold prices", supported: false, note: "Use Terapeak manually" },
    ],
    decision: "Implemented adapter; activates when credentials are added.",
    docsUrl: "https://developer.ebay.com/api-docs/buy/browse/overview.html",
  },
  {
    id: "ebay_sold",
    name: "eBay sold history",
    category: "sold_data",
    access: "restricted",
    summary: "Marketplace Insights API is restricted and closed to new users. Finding API (findCompletedItems) was shut down 2025-02-05. Terapeak has no API.",
    envVars: [],
    capabilities: [
      { label: "Automated sold comps", supported: false },
      { label: "Record sold comps from Terapeak with evidence", supported: true, note: "Implemented" },
    ],
    decision: "Human-assisted comp workflow. Active listings are never substituted for sold prices.",
    docsUrl: "https://developer.ebay.com/api-docs/buy/marketplace-insights/static/overview.html",
  },
  {
    id: "ebay_sell",
    name: "eBay seller account (Sell APIs)",
    category: "selling",
    access: "official",
    summary: "Inventory, Fulfillment (orders), and Finances (fees, payouts) APIs via user OAuth with an 18-month refresh token.",
    envVars: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_RUNAME"],
    capabilities: [
      { label: "Import orders and fees", supported: false, note: "Planned for Phase 3; record sales manually today" },
      { label: "Create listings", supported: false, note: "Planned; listing drafts are generated for copy and paste" },
    ],
    decision: "Not yet implemented. Sales are recorded manually with order-id idempotency.",
    docsUrl: "https://developer.ebay.com/api-docs/sell/static/sell-landing.html",
  },
  {
    id: "anthropic",
    name: "Claude (Anthropic API)",
    category: "ai",
    access: "paid",
    summary: "Image identification, hidden-gem detection, screenshot extraction, and the AI Advisor. Arithmetic stays in deterministic code.",
    envVars: ["ANTHROPIC_API_KEY"],
    capabilities: [
      { label: "Listing photo identification", supported: true },
      { label: "Screenshot import", supported: true },
      { label: "AI Advisor with read-only tools", supported: true },
    ],
    decision: "Implemented with schema-validated outputs, result caching, and a monthly budget cap.",
    docsUrl: "https://docs.anthropic.com",
  },
  {
    id: "google_routes",
    name: "Google Maps Routes API",
    category: "routing",
    access: "paid",
    summary: "Traffic-aware drive time, distance, and toll estimates. Monthly free usage per SKU, then per-request pricing.",
    envVars: ["GOOGLE_MAPS_API_KEY"],
    capabilities: [
      { label: "Drive time and distance", supported: true },
      { label: "Traffic-aware", supported: true },
      { label: "Toll estimates", supported: true },
      { label: "Route matrix for multi-stop trips", supported: true },
    ],
    decision: "Implemented adapter. Without a key, enter drive times manually; straight-line distance is never used.",
    docsUrl: "https://developers.google.com/maps/documentation/routes",
  },
  {
    id: "resend",
    name: "Email (Resend)",
    category: "notifications",
    access: "paid",
    summary: "Transactional email for high-priority alerts.",
    envVars: ["RESEND_API_KEY", "ALERT_EMAIL_TO", "ALERT_EMAIL_FROM"],
    capabilities: [{ label: "Alert emails", supported: true }],
    decision: "Implemented dispatcher; activates when configured.",
    docsUrl: "https://resend.com/docs",
  },
  {
    id: "web_push",
    name: "Browser push (Web Push)",
    category: "notifications",
    access: "official",
    summary: "Free push notifications to installed PWAs, including iOS 16.4+ home-screen apps.",
    envVars: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"],
    capabilities: [{ label: "Push alerts", supported: true }],
    decision: "Implemented; activates when VAPID keys are configured.",
    docsUrl: "https://developer.mozilla.org/docs/Web/API/Push_API",
  },
  {
    id: "pricecharting",
    name: "PriceCharting",
    category: "reference",
    access: "paid",
    summary: "Price guide for games, cards, and comics (subscription). Price guides are context, not sold transactions.",
    envVars: [],
    capabilities: [{ label: "Price guide lookups", supported: false, note: "Not implemented; record as price-guide evidence manually" }],
    decision: "Deferred until volume justifies the subscription.",
    docsUrl: "https://www.pricecharting.com/api-documentation",
  },
  {
    id: "keepa",
    name: "Keepa",
    category: "reference",
    access: "paid",
    summary: "Amazon-only price history. Limited relevance for local flips.",
    envVars: [],
    capabilities: [{ label: "Amazon price history", supported: false }],
    decision: "Not implemented.",
    docsUrl: "https://keepa.com/#!api",
  },
];

export function isConfigured(d: IntegrationDescriptor): boolean {
  return d.envVars.length > 0 && d.envVars.every((v) => !!process.env[v]);
}
