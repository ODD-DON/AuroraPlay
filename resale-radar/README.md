# Resale Radar

Resale intelligence for a solo reseller: find overlooked value, verify it with sold evidence, calculate every cost (fees, shipping, travel, risk), negotiate within a hard maximum, and track real profit from a $1,000 bankroll toward $30,000.

Home base: Lockport, Illinois. Distance is a cost, not a barrier: deals farther away qualify when verified profit clears a higher, distance-based threshold (Worth the Drive).

## Quick start (no accounts or keys needed)

```bash
cd resale-radar
npm install
npm run dev          # http://localhost:3000
```

Local mode stores data in an embedded Postgres under `.data/` (same schema and row-level security as production) and runs background jobs in-process. Open the app, complete the 1-minute setup, and import a listing.

## What works today

- Import listings by URL (Facebook Marketplace, eBay, Craigslist, OfferUp, any link), the Android share sheet (PWA share target), or a screenshot (Claude reads it when an API key is set). Repeat imports are detected and price drops tracked.
- Full deterministic evaluation: sold-comp valuation (P25 / median / P75, outlier rejection), sell-through and time-to-sale, eBay fees by category tier (including fees on shipping and sales tax), shipping and supplies, travel cost (mileage-rate or actual-expense, never both), wasted-trip and risk allowances, three scenarios, break-even prices, and the maximum purchase price.
- Decisions: Strong Buy, Buy If Negotiated, Worth the Drive, Hidden Gem, Research Required, Pass, Unavailable, each with hard-filter results and a plain-language explanation of evidence, risks, and invalidators.
- Hidden Gem research workspace: AI hypotheses (never auto-verified), evidence log, required photos, category valuation rules.
- Negotiation Center: offer ladder (open / target / never above), natural message drafts you copy and send yourself, counteroffer evaluation with profit at each price.
- Pickup Planner: agreed pickups, cash needed, multi-stop trip optimization with fair travel-cost allocation, category inspection checklists, safety guidance.
- Inventory with aging buckets, listing assistant (title, specifics, fast / market / high-margin prices with net proceeds), sale recording, shipping, refunds and partial refunds, write-offs.
- Double-entry ledger, P&L, buying power after reserve and commitments, bankroll milestones, CSV export.
- Analytics: sourcing funnel, realized profit by month and category, predicted vs actual, AI accuracy, API cost tracking against a monthly budget.
- AI Advisor (with an Anthropic key): answers from your records through read-only tools; all math via the engine.
- Watchlists with automatic eBay searching (with eBay keys), notification center, email and web push dispatch (when configured), dark/light themes, installable PWA, mobile layout.

## Integrations

See `docs/integration-feasibility.md` for the verified capability matrix. Summary:

| Source | Status |
|---|---|
| Facebook Marketplace | No authorized API. Manual import, share target, screenshots. Messages drafted for you to send. |
| eBay Browse (active listings) | Adapter built; set `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET`. Not yet tested against live eBay. |
| eBay sold history | Closed to new developers (Marketplace Insights restricted, Finding API retired). Human-assisted comp workflow from Terapeak. |
| eBay seller account (orders, fees) | Not built yet; sales are recorded manually with order-number idempotency. |
| Claude (Anthropic) | Built; set `ANTHROPIC_API_KEY`. Not yet tested against the live API in this environment. |
| Google Routes | Built; set `GOOGLE_MAPS_API_KEY`. Not yet tested live. Without it, enter drive times manually. |
| Email (Resend), Web Push | Built; activate with the env vars in `.env.example`. |

## Production deployment

1. Create a Supabase project. Apply the schema: `DATABASE_URL=... npm run db:migrate` (or paste `supabase/migrations/*.sql` into the SQL editor). Create a private Storage bucket named `resale-radar`.
2. Set env vars from `.env.example` (`DATABASE_URL`, Supabase URL/keys, and any integrations you want).
3. Deploy the Next.js app (Vercel or any Node host).
4. Background jobs: run `npm run worker` on a long-lived host, or have a scheduler call `GET /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` every few minutes.

## Development

```bash
npm run typecheck    # TypeScript
npm test             # unit + integration tests (engine, ledger, schema, RLS, workflows)
npm run test:e2e     # Playwright acceptance flow and mobile layout checks
npm run build        # production build
```

Docs: `docs/ARCHITECTURE.md` (design and decisions), `docs/PROGRESS.md` (status, limitations, next steps), `docs/integration-feasibility.md` (API research).
