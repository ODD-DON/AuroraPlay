# Resale Radar: Architecture and Decisions

## System overview

```
Browser (PWA, dark-first UI)
   |  Server Components render pages; Server Actions handle every mutation (zod-validated)
   v
Next.js 16 App Router (Node runtime)
   |-- src/app/*            pages, server actions, route handlers (files, cron, CSV export, push)
   |-- src/server/services  domain services: opportunities, research, negotiation, inventory, planning, automation
   |-- src/server/jobs      Postgres-backed job queue, scheduler, notification dispatch
   |-- src/integrations     adapters: Claude, Google Routes, eBay Browse, registry/capabilities
   |-- src/domain           PURE deterministic engine (no I/O): money, fees, travel, profit, valuation,
   |                        liquidity, risk, evaluate (classification + scoring), negotiation, trips,
   |                        search tiers, dedup, ledger, capital allocation, inspection checklists
   v
PostgreSQL (Supabase in production, embedded PGlite locally) with row-level security on every owned table
```

The domain layer is framework-free TypeScript. The same `evaluateOpportunity` function runs on the server for stored deals and in the browser for the Deal Analyzer, so there is exactly one implementation of every financial rule.

## Evaluation pipeline

Implemented stages (spec section 25) and where they live:

| Stage | Implementation |
|---|---|
| 1 Ingestion | `importListing` (URL, share target, screenshot, manual, eBay API) |
| 2 Normalization | `canonicalizeUrl`, integer cents, explicit `location_precision`, missing fields stored as null |
| 3 Deduplication | exact id/URL match updates the existing deal and price history; fuzzy matches (title trigram, price, seller, image dHash) are linked, never auto-merged on image alone |
| 4 Low-cost filtering | `searchTiers.worthAnalyzing` before any paid call; AI runs only on request or for promising candidates |
| 5 Identification | Claude vision (`identifyListing`), schema-validated, cached by input hash, hypotheses only |
| 6 Market research | `valueFromComparables`: sold evidence only, MAD outlier rejection, P25/median/P75, thin-evidence widening, trend fit |
| 7 Demand | `estimateLiquidity`: sold-to-active ratio as an indicator, days-of-inventory time-to-sale, "unknown" when data is missing |
| 8 Financial | `calculateProfit`, `runScenarios`, break-even and max-price solvers |
| 9 Geographic | `computeTravelCost`, `qualifyTravel` (tiered thresholds), `planTrip` |
| 10 Risk | auto-derived and user-flagged `RiskFactor`s with allowances; critical factors block qualification |
| 11 Classification | `evaluateOpportunity` hard filters and decision tree |
| 12 Notification | `createAlert` (deduped by key), `dispatchNotifications` (email/push for high+critical, quiet hours) |
| 13 Feedback | `user_decisions`, `identification_reviews`, `ai_feedback`, predicted-vs-actual analytics |

Every evaluation is stored as a new version in `opportunity_evaluations` with the exact input and output JSON and the engine version, so any recommendation can be reproduced and audited.

## Key decisions

1. **Integer cents and basis points everywhere.** Database columns are `integer` cents (max about $21M per value, ample for this business). Rates are integer bps. Floats appear only transiently and are rounded immediately. AI and routing costs are stored in microdollars so sub-cent calls stay exact.

2. **One vehicle-cost method at a time.** `VehicleCostMethod` is a discriminated union: the mileage-rate variant has no fuel field, so fuel can never be added on top of a rate that already includes it. Tolls and parking are always separate. The owner's time value is reported as profit per hour and never subtracted from operating profit.

3. **Distance thresholds use real drive time.** Thresholds are selected from routed one-way minutes. Approximate locations add a configurable buffer (default 5 minutes) and are labeled provisional. With no routing key, the owner enters drive time; straight-line distance is never used as a substitute. Search APIs that only accept a mile radius get an approximate radius for query scoping only.

4. **Worth the Drive is the same evaluation, not a bypass.** A deal outside the local area must pass every hard filter, including the higher tier threshold after travel costs, plus a minimum profit per sourcing hour. Over 60 minutes it also requires manual review. Beyond the configurable maximum travel range it is passed. A hidden-gem hypothesis can never produce Worth the Drive: identity, authenticity (where required), and sold comps are hard filters.

5. **Conservative scenario drives decisions.** Thresholds, ROI, and the maximum purchase price are evaluated on the conservative scenario (P25 or lowest comp for thin evidence, higher selling costs, higher returns allowance, longer hold). A stress case at the lowest qualifying comp must not lose more than a configurable share of cash invested.

6. **Sold evidence only.** Only `sold_verified` and `sold_user_recorded` comparables enter valuation. Active listings, price guides, auction estimates, and AI estimates are stored and displayed as context, and the UI says so. eBay sold-history APIs are closed to new developers, so the product's comp workflow is human-assisted with saved evidence links.

7. **Fee schedules are data with provenance.** Each schedule carries source URL, effective date, and a verified flag. The final value fee is computed marginally per tier on item + shipping + sales tax, plus the per-order fee threshold. Unverified schedules are flagged in the UI.

8. **Double-entry ledger with database enforcement.** Every financial event posts balanced lines. A deferred constraint trigger rejects unbalanced entries at commit; an update trigger makes lines immutable (corrections are new entries). `external_ref` is unique per owner, which makes imported orders, refunds, and the opening bankroll idempotent. Purchases move cash to inventory; COGS is recognized at sale.

9. **RLS even for server code.** `withOwner` opens a transaction, sets JWT claims, and switches to the `authenticated` role, so row-level security applies to every app query, not just client queries. Only the job worker uses service-level access, and its handlers re-enter `withOwner` per job.

10. **Embedded Postgres for local mode.** PGlite runs the exact Supabase migration SQL behind a small `auth` shim, so the app is fully functional with zero credentials and tests run against real Postgres semantics (constraints, triggers, RLS).

11. **AI safety boundaries.** Listing text is fenced in `<untrusted_*>` tags with control characters stripped; system prompts instruct the model to treat it as data. Outputs are schema-constrained and re-validated with zod; numbers are clamped. The advisor has read-only tools and deterministic calculators only; it cannot send messages, buy, or modify records. AI never marks identity verified. Refusals and truncation are handled explicitly. Server-side refusal fallbacks are enabled on supported models.

12. **No unauthorized automation.** Facebook Marketplace has no authorized read or messaging API, so it is supported through URL import, an Android share target, and screenshot extraction. Messages are drafted for the owner to send; recording them never transmits anything.

13. **Background work that fits the deployment.** Jobs live in `background_jobs` (idempotency key, `SKIP LOCKED` claiming, exponential backoff, dead-lettering). Production runs `npm run worker` as a long-lived process, or a scheduler calls `/api/cron/tick` (bounded batch, bearer secret). Local mode runs the scheduler in-process because PGlite is single-process.

14. **Cost controls.** Monthly software budget is enforced before every paid call; usage is recorded per provider in `api_usage` and shown in Analytics. Identification results are cached by a hash of prompt version, model, listing text, and image hashes.

## Data model

See `supabase/migrations/20261013000001_core_schema.sql`. Groups: identity, integrations, search and discovery, opportunities and evaluations, identification, market research, geography, negotiation, inventory and selling, finance, and supporting systems (alerts, notifications, AI runs, feedback, audit log, jobs).

## Security notes

- Secrets are server-side env vars only; `.env*` is gitignored and nothing secret is passed to client components.
- Uploads: MIME allow-list, 10 MB limit, re-encoded with sharp (strips EXIF and GPS), served only to their owner through `/api/files`.
- CSV export neutralizes spreadsheet formula injection.
- Security headers: `nosniff`, `X-Frame-Options: DENY`, strict referrer, restrictive permissions policy.
- Server actions are POST-only with Next.js origin checks; SQL is always parameterized; database error text is not echoed to the client.
- The exact home address is optional, stored only in settings, and never rendered elsewhere.
