# Development Progress

Last updated: 2026-10-13.

## Completed

**Foundation (Phase 1)**
- Next.js 16 App Router, React 19, TypeScript strict, Tailwind 4, Lucide, Recharts, Zod.
- PostgreSQL schema (60+ tables) with row-level security on every owned table, integer-cent money, unique keys for idempotent imports and orders, a deferred trigger that rejects unbalanced ledger entries, and immutable ledger lines.
- Two database drivers behind one interface: Supabase Postgres (`DATABASE_URL`) and embedded PGlite for zero-credential local use. RLS is enforced for server code through `withOwner`.
- Supabase Auth (password and magic link) with session refresh in `proxy.ts`; local single-owner mode.
- Design system (dark default, light optional), responsive app shell with all 14 areas, mobile bottom navigation, installable PWA with share target and service worker.
- Structured JSON logging with secret redaction, integration retry/backoff, Postgres job queue with idempotency keys, SKIP LOCKED claiming, exponential backoff, dead-lettering; worker script, cron endpoint, in-process scheduler for local mode.

**Financial and research core (Phase 2)**
- Deterministic engine: fees, travel, profit, scenarios, break-even and max-price solvers, valuation, liquidity, risk, classification and scoring, negotiation ladder, multi-stop trips, search tiers, dedup, ledger, capital allocation, inspection checklists.
- Listing import (URL, share, screenshot, manual), photo upload with EXIF stripping, comparable recording with evidence types, demand recording, travel (manual, Google, shipped), facts, risks, decisions, versioned evaluations.

**Real data integrations (Phase 3, partial)**
- eBay Browse adapter (active listing search with local-pickup radius, active counts), watchlist runner, source health reporting and error log.

**Hidden-gem intelligence (Phase 4)**
- Claude vision identification with multi-object detection, up to 3 hypotheses per object, supporting and conflicting evidence, required photos, research priority, red-flag mapping to risk factors; schema validation, caching, budget enforcement. Owner confirmation workflow and evidence log.

**Negotiation and travel (Phase 5)**
- Negotiation CRM, drafts, manual-send recording, counteroffer evaluation, agreement capture bounded by the maximum, Worth the Drive classification, trip planner, inspection checklists.

**Inventory and selling (Phase 6)**
- Inventory lifecycle and aging, listing assistant with price tiers and net proceeds, sale recording, shipping, refunds, write-offs, realized-profit ledger, financial reporting and CSV export.

**Intelligence (Phase 7, partial)**
- Scheduled monitoring, event alerts with dedup and priority, email and push dispatch with quiet hours, analytics, AI Advisor with read-only tools, capital allocation tool, API cost dashboard.

## Tests

- 81 unit and integration tests (`npm test`): fees and tiers, per-order fee threshold, tax and shipping fee basis, seller adjustments, ROI, break-even, max purchase price, scenarios, travel tiers and costs (no double counting), approximate-location buffer, trips and allocation, search tiers, valuation and outliers, liquidity, all decision paths including Worth the Drive and manual review, negotiation guardrails, capital allocation, dedup, ledger (purchase, sale, COGS, refunds, partial refunds, write-offs, withdrawals, buying power), schema migration, RLS isolation, ledger balance trigger, idempotency, full service-layer workflow, AI output handling, prompt fencing, job queue.
- 2 Playwright tests (`npm run test:e2e`): the complete acceptance workflow through the UI (setup, import with photo, missing-data display, comps, demand, facts, evaluation, offer, negotiation including an over-max counter, agreement, inspection and purchase, listing, sale, realized profit, ledger CSV, analytics) and phone-width layout checks with no horizontal overflow on key screens.
- Production build passes.

## Blocked or awaiting credentials

| Integration | Needed | Notes |
|---|---|---|
| Claude | `ANTHROPIC_API_KEY` | Code paths unit-tested with synthetic outputs only; no live call made. |
| Google Routes | `GOOGLE_MAPS_API_KEY` | Not called live. Request format follows the Routes v2 docs; verify on first use. |
| eBay Browse | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | Not called live. |
| Supabase | project URL, anon key, service role key, `DATABASE_URL` | Schema verified on embedded Postgres (PGlite); not yet applied to a hosted project. |
| Email / Push | `RESEND_API_KEY` etc., VAPID keys | Dispatcher built; the in-app push subscription button is not built yet (the API endpoint exists). |

## Known limitations

- Facebook Marketplace cannot be searched or messaged automatically through any authorized method. This is by design, not a gap to work around.
- Automated eBay sold data is unavailable to new developers; comps are recorded by hand from Terapeak with links.
- eBay fee rates were matched against eBay pages through a search index, not opened directly; video game console and guitar rates are only partially confirmed. The schedule stays flagged "unverified" until you confirm it.
- IRS mileage default is 76 cents (July 2026 rate per Announcement 2026-11, reported by secondary sources); 72.5 cents is the confirmed January to June rate. Editable in Settings.
- Time-to-sale is a days-of-inventory heuristic until you have at least five of your own sales in a category, then it blends in your history.
- Multi-stop trips need stop-to-stop drive times entered manually unless the Google route matrix is wired into the planner UI (the adapter exists).
- AI identification processes up to 8 photos per run; object bounding boxes are not drawn on images yet.
- Income tax estimates are not computed; the ledger exports cost basis and realized profit for a tax preparer.

## Next priorities

1. Connect keys and verify each live integration (Claude, Routes, eBay Browse), then mark them tested.
2. eBay Sell API OAuth: import orders, fees, and payouts automatically (Fulfillment and Finances APIs).
3. Push-notification opt-in button and email digest.
4. Route-matrix integration in the trip planner; seller time windows in the UI.
5. Weekly AI business review and suggested watchlists from profitable categories.
6. Fee-schedule verification screen and per-category overrides.
