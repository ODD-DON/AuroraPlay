# Resale Radar: Integration Feasibility

Prepared for: a single reseller in Lockport, Illinois (eBay seller, Facebook Marketplace as primary sourcing channel, roughly $1,000 bankroll).
Research date: 2026-10-13.

## How this was verified (read first)

- Verification method: web search restricted to official domains (developer.ebay.com, ebay.com, irs.gov, developers.google.com, transparency.meta.com, facebook.com, twilio.com, webkit.org, platform.claude.com, anthropic.com, psacard.com, pricecharting.com, keepa.com, discogs.com, scryfall.com, usps.com) where possible, reading the indexed text of those pages.
- Limitation: direct page fetching (WebFetch/curl) was blocked by the research sandbox's network policy on 2026-10-13, so pages could not be opened in full. Where a fact came only from a search snippet of an official page, it is marked "verified on 2026-10-13 (official page, via search index)". Where only third-party sources were found, it is marked "secondary source" and repeated in the Unverified list.
- Nothing in this document recommends scraping, CAPTCHA bypass, unofficial/internal endpoints, or any terms-of-service circumvention. Where no official access exists, the decision is "manual workflow" or "do not implement".

## 1. Summary capability matrix

Legend: Y = yes, N = no, R = restricted (approval/contract required), P = partial, ? = not confirmed.

| Integration | Official API | Access | Commercial use OK | Search | Images | Location | Sold prices | Messaging | Buyer offers | Est. cost/mo | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Facebook Marketplace | N (for reading others' listings) | Unavailable (research-only MCL) | N (ToS bans automated collection) | N | N | N | N | N | N | $0 | Manual workflow |
| eBay Browse API | Y | Public (app token) | Y, within API License limits | Y | Y | P (city/state; postal code anonymized) | N | N | N | $0 | Implement now |
| eBay Marketplace Insights | Y | R (closed to new users) | R | Y | ? | ? | Y | N | N | n/a | Adapter stub awaiting credentials (unlikely) |
| eBay Finding findCompletedItems | Decommissioned 2025-02-05 | Unavailable | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Do not implement |
| eBay Terapeak / Product Research | N (UI only) | Free in Seller Hub | UI use only | UI | UI | UI | UI (3 yrs) | N | N | $0 | Manual workflow (deep link) |
| eBay Sell APIs (Inventory, Fulfillment, Finances, Analytics) | Y | Public (user OAuth) | Y (own account) | n/a | Y (own) | n/a | Own sales only | N (see Message API) | n/a | $0 | Implement now (Fulfillment, Finances first) |
| eBay Negotiation API | Y | Public (user OAuth) | Y | n/a | n/a | n/a | n/a | N | Seller-to-watcher offers | $0 | Implement later |
| eBay Buy Offer API (bidding) | Y | R (Limited Release, contract) | R | n/a | n/a | n/a | n/a | N | R | n/a | Do not implement |
| eBay fee schedule | n/a (help page) | Public | n/a | n/a | n/a | n/a | n/a | n/a | n/a | $0 | Implement now (static config table) |
| PriceCharting API | Y | Paid (Legendary tier) | Internal use only without commercial license | Y | ? | N | Current prices from sales (eBay/TCGplayer tagged) | N | N | $49 | Adapter stub (optional paid) |
| Keepa API | Y | Paid (tokens) | Y per plan | Amazon only | Y | N | Amazon price history (not sold comps) | N | N | about EUR 49 | Do not implement now |
| PSA Public API | Y | Free tier (limit disputed) | Per PSA terms | Cert lookup only | ? | N | N | N | N | $0 | Adapter stub |
| Discogs API | Y | Free (key/OAuth) | Per Discogs terms | Y | Y | N | Marketplace stats/price suggestions (account-scoped) | N | N | $0 | Adapter stub |
| BrickLink API | Y | Free (seller account, IP-bound token) | Per BrickLink API terms | Catalog | Y | N | Price guide (sold + current) | N | N | $0 | Adapter stub |
| TCGplayer API | Y (legacy) | Closed to new developers | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Do not implement |
| Scryfall | Y | Free, no key | Y with attribution/caching rules | Y | Y | N | Daily price snapshot (not sold comps) | N | N | $0 | Implement when MTG needed |
| Pokemon TCG API / Scrydex | Y | Free key / commercial successor | Per terms | Y | Y | N | Daily market price fields | N | N | $0 to paid | Adapter stub |
| CGC, Beckett, 130point, Card Ladder, Market Movers, WorthPoint, Heritage | N public API found | UI only | n/a | UI | UI | n/a | UI | n/a | n/a | subscriptions vary | Manual workflow (deep links) |
| Estate sale and local marketplaces (EstateSales.net/.org, Craigslist, OfferUp, Mercari, Nextdoor, AuctionNinja, HiBid, MaxSold) | N public read API found | Unavailable | N (Craigslist ToS explicit) | N | N | N | N | N | N | $0 | Manual workflow |
| Shippo / EasyPost | Y | Public | Y | n/a | n/a | n/a | n/a | n/a | n/a | $0 on free tiers | Adapter stub |
| USPS APIs (new platform) | Y | Public (OAuth 2.0) | Y | n/a | n/a | n/a | n/a | n/a | n/a | $0 | Adapter stub |
| eBay shipping labels (Logistics API) | Y | R (Limited Release) | R | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Manual workflow (Seller Hub) |
| Google Routes API | Y | Public (billing account) | Y | n/a | n/a | Y | n/a | n/a | n/a | $0 under free caps | Implement now |
| Mapbox / OpenRouteService / OSRM | Y | Public | Y per terms | n/a | n/a | Y | n/a | n/a | n/a | $0 | Fallback adapter |
| Web Push (VAPID) | Y (W3C standard) | Free | Y | n/a | n/a | n/a | n/a | n/a | n/a | $0 | Implement now |
| Email (Resend) | Y | Free tier | Y | n/a | n/a | n/a | n/a | n/a | n/a | $0 | Implement now |
| Twilio SMS | Y | Requires A2P 10DLC registration | Y | n/a | n/a | n/a | n/a | n/a | n/a | about $2 to $10 + fees | Do not implement now |
| Pushover / ntfy | Y | Paid one-time / free | Y | n/a | n/a | n/a | n/a | n/a | n/a | $4.99 one-time / $0 | Optional |
| IRS mileage rate | n/a | Public | n/a | n/a | n/a | n/a | n/a | n/a | n/a | $0 | Implement now (config) |
| Anthropic Claude API | Y | Public (API key) | Y | n/a | Vision Y | n/a | n/a | n/a | n/a | about $2 to $6 | Implement now |

## 2. Detailed sections

### 2.1 Facebook Marketplace (Meta)

- Officially supported for this use: No. There is no public Meta API for searching or reading other people's Marketplace listings, messaging sellers, or submitting offers.
- What does exist:
  - Marketplace Partnerships / listing partners and Catalog (Commerce) APIs: these let approved retailers and partners push their own inventory into Marketplace. Commerce Partner status is invite-only, and Meta's retail-inventory-on-Marketplace program is described as US-only. These are seller-side push APIs, not search/read APIs. Source: https://developers.facebook.com/docs/marketplace/partnerships/ , https://www.facebook.com/business/help/2197639333799894 , https://www.facebook.com/business/marketing-partners/become-a-partner/commerce (verified on 2026-10-13, official page, via search index).
  - Graph API v26.0 changelog: deprecates the Commerce Order Management API (47 endpoints), with calls blocked on v26.0+ from 2026-07-29 and removal from all versions on 2026-10-27, tied to the sunset of Checkout on Facebook/Instagram Shops; no replacement. Not a Marketplace read API, but it shows the commerce surface is shrinking. Source: https://developers.facebook.com/docs/graph-api/changelog/version26.0/ (verified on 2026-10-13, via search index).
  - Meta Content Library and API: includes Facebook Marketplace listings, but access requires affiliation with an academic institution or a not-for-profit research organization, with proposals vetted by an independent reviewer. A commercial reseller is not eligible. Source: https://transparency.meta.com/researchtools/meta-content-library/ (verified on 2026-10-13, via search index).
- Terms on automated collection: Meta Terms of Service section 3 states users "may not access or collect data from our Products using automated means (without our prior permission)", regardless of whether logged in. Meta's robots.txt carries a similar notice. Source: https://www.facebook.com/terms (verified on 2026-10-13, via search index).
- Messaging and offers: no API. Must be done by the user in the Facebook/Messenger app.
- Authorized alternatives for Resale Radar:
  1. User URL import: the user pastes a Marketplace listing URL; the app stores the URL plus fields the user types or confirms (title, price, distance, notes). The app does not fetch the page server-side.
  2. Mobile share sheet: install Resale Radar as a PWA with a Web Share Target so the user can "Share" a listing from the Facebook app into Resale Radar (receives the URL and any shared text).
  3. Screenshots: user uploads a screenshot; Claude vision extracts title, price, condition cues, and visible text into a draft record the user confirms.
  4. User-received notifications: Facebook offers Marketplace notifications for items similar to what the user browses and lets the user sort by newest; the user acts on those in the Facebook app and shares promising ones into Resale Radar. Details of saved-search alerts could not be confirmed (see Unverified list). Source: https://www.facebook.com/help/1889067784738765
- Rate limits / cost / auth: not applicable.
- Reliability risk: high for any automated approach (account bans, legal exposure). Zero for manual workflows.
- Resale Radar decision: **Manual workflow** (URL import, share target, screenshot extraction). Do not implement any automated Marketplace collection.

### 2.2 eBay Browse API (item_summary/search)

- Officially supported: Yes. Public production access with an application access token (OAuth client credentials grant, scope `https://api.ebay.com/oauth/api_scope`).
- Search capabilities (official filter reference https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html, verified on 2026-10-13 via search index):
  - Keyword `q`, `category_ids`, `gtin`, `epid`, `aspect_filter`, `sort` (price, distance, newlyListed, endingSoonest).
  - Filters include `price` with `priceCurrency`, `conditions` / `conditionIds`, `buyingOptions` (FIXED_PRICE, AUCTION, BEST_OFFER), `itemLocationCountry`, `deliveryCountry`, `deliveryPostalCode` (must be paired with `deliveryCountry`), `sellers`, `returnsAccepted`, and others.
  - Local pickup: `deliveryOptions:{SELLER_ARRANGED_LOCAL_PICKUP}` must be used together with `pickupCountry`, `pickupPostalCode`, `pickupRadius`, and `pickupRadiusUnit`. When the pickup set is used, `deliveryCountry`, `deliveryPostalCode`, and `itemLocationCountry` are ignored. The response then includes a `distance` container measured from `pickupPostalCode`. Curly braces in filter values must be URL-encoded. Example: `filter=deliveryOptions:%7BSELLER_ARRANGED_LOCAL_PICKUP%7D,pickupCountry:US,pickupPostalCode:60441,pickupRadius:50,pickupRadiusUnit:mi` (60441 is Lockport, IL).
- Images: `image.imageUrl` (primary), `additionalImages[]`, `thumbnailImages[]`. Source: https://developer.ebay.com/api-docs/buy/browse/types/gct:ItemSummary (verified on 2026-10-13 via search index).
- Location granularity: `itemLocation` may include city, stateOrProvince, country, and postalCode, but postalCode is anonymized (partial) and fields are conditionally returned. Treat location as approximate. Source: https://developer.ebay.com/api-docs/buy/browse/types/gct:Address
- Sold-price data: No. eBay developer support has stated the Browse API does not expose sold listings.
- Messaging / offers: No.
- Rate limits: Browse API default "All methods except getItems: 5000 API calls per day"; higher limits via the Application Growth Check. Source: https://developer.ebay.com/develop/get-started/api-call-limits (verified on 2026-10-13 via search index). Client-credentials token minting is separately rate-limited (see https://developer.ebay.com/api-docs/static/oauth-rate-limits.html).
- Cost: free.
- Commercial use: Permitted under the eBay API License Agreement for supporting the developer's own or users' use of eBay, but the license restricts commercializing, redistributing, or storing eBay Content beyond what is allowed, and historically required written permission to derive aggregated metrics such as average selling price by category. A single-user sourcing tool that displays live listings and links back to eBay is within normal use; do not resell or republish eBay data, and cache conservatively. Source: https://developer.ebay.com/join/api-license-agreement (verified on 2026-10-13 via search index; full text not read, see Unverified list).
- Reliability risk: low to moderate (API versioning changes, occasional 5xx with pickup filters reported in forums).
- Resale Radar decision: **Implement now** (active-listing comps, local pickup deals near 60441, "current asking price" context).

### 2.3 eBay sold-history

- Marketplace Insights API (`/buy/marketplace_insights/v1_beta/item_sales/search`): returns sales history of sold items. Labeled "Limited Release"; eBay's Buy API support page states "The Marketplace Insights API is restricted and not open to new users at this time." Sources: https://developer.ebay.com/api-docs/buy/marketplace_insights/resources/methods , https://developer.ebay.com/api-docs/buy/static/ref-marketplace-supported.html (verified on 2026-10-13 via search index).
- Finding API `findCompletedItems`: deprecated (access restricted) since 2020-10-15; all Finding API calls were decommissioned on **2025-02-05**. Source: https://developer.ebay.com/docs/api-deprecation , https://developer.ebay.com/DevZone/finding/CallRef/findCompletedItems.html (verified on 2026-10-13 via search index).
- Terapeak / Product Research: free to all Seller Hub users (since April 2021), shows up to 3 years of sold data, also on mobile. No API; developer forum answers confirm it is UI only. Source: https://export.ebay.com/en/resources/important-updates/ebay-news-archive/terapeak/ , https://www.ebay.com/sellercenter/resources/seller-updates/2024-summer/tools (verified on 2026-10-13 via search index).
- Other official alternative: the seller's own sold history via Fulfillment API (orders) and Finances API (transactions). This gives the user's own realized prices and fees, which is the most accurate comp data for their own niche.
- Resale Radar decision: **Manual workflow** for market sold comps (deep link to Seller Hub Research with prefilled keywords, user enters 3 to 5 comps or a median); **implement now** for own-sales history via Sell APIs; Marketplace Insights as an **adapter stub awaiting credentials** (do not plan around it). Do not implement Finding API.

### 2.4 eBay seller APIs

- Sell Inventory API: create/update inventory items and offers, publish listings. Note: listings created via Inventory API are managed through the API afterward (editing in Seller Hub is limited for such listings; verify before migrating existing listings).
- Sell Fulfillment API: `getOrders`, shipping fulfillment, refunds. Scope `https://api.ebay.com/oauth/api_scope/sell.fulfillment` (or `.readonly`).
- Sell Finances API: `getTransactions` (sales, shipping label purchases, fees, refunds, credits), `getPayouts`, `getTransactionSummary`. Scope `https://api.ebay.com/oauth/api_scope/sell.finances`; no Team Access; page size up to 1000 since v1.6.0. Source: https://developer.ebay.com/api-docs/sell/finances/resources/transaction/methods/getTransactions (verified on 2026-10-13 via search index).
- Sell Negotiation API: `find_eligible_items` and `send_offer_to_interested_buyers` (seller sends discount offers to watchers/interested buyers). Latest release v1.1.2 (2025-10-29) keeps only the default 4-day offer duration for US/UK. Source: https://developer.ebay.com/api-docs/sell/negotiation/resources/offer/methods/sendOfferToInterestedBuyers , https://developer.ebay.com/api-docs/sell/negotiation/release-notes.html
- Sell Analytics API: traffic report, seller standards profile, customer service metrics. Source: https://developer.ebay.com/api-docs/sell/analytics/overview.html
- Messaging: a Sell Message API page exists on developer.ebay.com (https://developer.ebay.com/develop/api/sell/message_api); scope and availability were not confirmed.
- Auth: OAuth authorization code grant (user consent). User access token lifetime 7,200 s (2 hours); refresh token `refresh_token_expires_in` 47,304,000 s (about 18 months). Refresh can be revoked early (password/username change, consent revoked). Refresh-token grant limit 50,000/day, auth-code grant 10,000/day. Sources: https://developer.ebay.com/api-docs/static/oauth-auth-code-grant-request.html , https://developer.ebay.com/api-docs/static/oauth-refresh-token-request.html , https://developer.ebay.com/api-docs/static/oauth-rate-limits.html (verified on 2026-10-13 via search index).
- Cost: free. Requires an eBay developer account and production keyset (and eBay's marketplace account deletion notification endpoint compliance for production keysets; not re-verified).
- Resale Radar decision: **Implement now** for Fulfillment + Finances (read-only, profit tracking, realized fee rate); **implement later** for Inventory and Negotiation; Analytics optional.

### 2.5 eBay buyer-side offers

- Buy Offer API (`placeProxyBid`, `getBidding`): Limited Release, production use requires eBay business-unit approval, eligibility, and contracts. Source: https://developer.ebay.com/api-docs/buy/offer/static/overview.html (verified on 2026-10-13 via search index).
- Best Offer submission via API: legacy Trading API `PlaceOffer` exists but requires a separate license addendum (https://developer.ebay.com/cms/files/placeoffer_api_license_addendum_uv_0.pdf). Not available to an ordinary developer.
- Resale Radar decision: **Do not implement**. The app can deep-link to the eBay listing ("Make offer" in the eBay app) and suggest a max offer price.

### 2.6 eBay US managed-payments fee schedule

Primary source: https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822 (non-Store / basic seller table). Supporting: https://www.ebay.com/help/selling/fees-credits-invoices/store-selling-fees-managed-payments-sellers?id=4809 , https://www.ebay.com/sellercenter/selling/start-selling-on-ebay/seller-fees , https://www.ebay.com/sellercenter/resources/seller-updates/2025-january/final-value-fee .
Verified on 2026-10-13 via search index of the official pages. No effective-date stamp was visible on the help page. The last confirmed official rate change is the update effective 2025-02-14 (increases up to 0.35 percentage points in most categories). Third-party sources report an April 2026 update that left most categories unchanged and lowered sneakers; not confirmed on eBay's site.

| Category | Final value fee (per item, on total amount of sale) | Confidence |
|---|---|---|
| Most categories | 13.6% up to $7,500; 2.35% on portion over $7,500 | Verified (official) |
| Trading cards: Sports Trading Cards, Non-Sport Trading Cards, Collectible Card Games | 13.25% up to $7,500; 2.35% over $7,500 | Verified (official; page example: $10,070 sale = 13.25% of $7,500 + 2.35% of $2,570 + $0.40 = $1,054.55) |
| Coins & Paper Money (non-bullion) | 13.25% up to $7,500; 2.35% over $7,500 | Verified (official) |
| Bullion | 13.6% if sale is $7,500 or less; 7% if over $7,500 | Partial (Store fee page; confirm on basic table) |
| Video Game Consoles | 7.35% up to $2,500; 2.35% over $2,500 | Partial (Store fee page and Jan 2025 update) |
| Watches, Parts & Accessories | 15% up to $1,000; 6.5% on $1,000.01 to $7,500; 3% over $7,500 | Verified (official) |
| Jewelry & Watches (excluding watches) | 15% if sale is $5,000 or less; 9% if over $5,000 | Verified (official) |
| Women's Bags & Handbags | 15% if sale is $2,000 or less; 9% if over $2,000 | Verified (official) |
| Guitars & Basses | 6.7% up to $7,500; 2.35% over $7,500 | Partial (Store fee page) |
| Books & Magazines, Movies & TV, Music (vinyl records are in "Most categories") | 15.3% up to $7,500; 2.35% over $7,500 (Store table may use a $2,500 breakpoint) | Verified rate; threshold partially verified |
| NFT categories | 5% | Verified (official) |
| Athletic sneakers $150 or more | 8%, no per-order fee | Partial (official snippet shows 8%; date of change unconfirmed) |

- Per-order fee: $0.30 if order total is $10.00 or less; $0.40 if over $10.00. Verified (official).
- Fee base: percentage applies to the total amount of the sale, including item price, shipping, sales tax, and other applicable fees. Verified (official). A snippet also states no FVF is charged on shipping when free domestic shipping is offered (i.e., there is no shipping charge to include).
- Below Standard surcharge: if the US account is Below Standard at the 20th-of-month evaluation, an additional 6% is applied to final value fees for the following calendar month, rising to 7% after four or more consecutive months. Not applied to Above Standard or Top Rated sellers. Verified (official, via search index).
- Top Rated Plus discount: 10% off final value fees (not the per-order fee) for Top Rated sellers on qualifying listings (30-day free returns, handling time requirements). Partial (community and older pages; confirm current terms).
- International fee: applies when buyer's address country differs from seller's registered country; not charged for US sellers using eBay International Shipping. The percentage (commonly cited as 1.65%) **could not be verified** on an official page.
- Store subscribers: Store tables can differ by category; not tabulated here.
- Promotional: a "Save 50% on final value fees" promotion for trading card singles $1,000+ was found (https://pages.ebay.com/promo/2025/tc-singles/); current status unknown.
- Resale Radar decision: **Implement now** as a versioned config table (`fees.ebay.us.2025-02-14`) with a "last verified" date, and reconcile against the user's actual Finances API fee lines (actual realized fee rate is the ground truth).

### 2.7 PriceCharting API

- Officially supported: Yes. Requires a paid subscription; API access is listed under the Legendary tier (about $49/month; Collector about $6/month has no API). Token from the Subscription page. Source: https://www.pricecharting.com/api-documentation , https://www.pricecharting.com/pricecharting-pro (verified on 2026-10-13 via search index; pricing page may be dated).
- Data: current prices per product by condition (loose, complete-in-box, new, and graded tiers for cards/comics shown on item pages). The site owner has stated the API returns current prices, not historical series. Item pages show sales tables tagged by source marketplace (e.g., [eBay], [TCGPlayer]); prices are derived from those completed sales.
- Commercial terms: API/CSV data licensed for internal business use with a valid Legendary subscription; sharing with third parties or exposing in an app used by others needs a commercial license. A single-user tool appears to fit internal use. Source: https://www.pricecharting.com/page/terms-of-service
- Images / location / messaging / offers: not applicable or not confirmed.
- Resale Radar decision: **Adapter stub awaiting credentials** (enable only if video games or cards become a core niche; $49/mo is about 5% of the bankroll).

### 2.8 Keepa API

- Officially supported: Yes. Prepaid monthly token plans, tokens refill per minute and expire after 60 minutes; a product request costs 1 token per ASIN plus extra for offer pages. Source: https://keepa.com/api-docs/plans-tokens.html (official mechanics, via search index). Entry plan price about EUR 49/month for 20 tokens/minute per secondary source (not verified on keepa.com).
- Scope: Amazon only (price history, sales rank, offers, Buy Box). No eBay or Marketplace data; Amazon sales rank is a velocity proxy, not sold comps.
- Resale Radar decision: **Do not implement now** (out of scope for an eBay-first reseller; revisit only if selling on Amazon).

### 2.9 Collectibles databases

| Source | Official API for this use | Notes | Decision |
|---|---|---|---|
| PSA | Yes: Public API, cert lookup (`/cert/GetByCertNumber/{certNumber}`), bearer token from PSA login. Docs state 100 calls/day free. A mid-2026 secondary source claims the free tier was cut sharply; unconfirmed. https://www.psacard.com/publicapi/documentation | Cert verification only, no prices | Adapter stub |
| CGC | No public API found; web cert lookup only | Manual verification | Manual workflow |
| Beckett | No public API found | | Manual workflow |
| 130point | No official API found | Do not automate | Manual workflow (deep link) |
| Card Ladder | No public API found (consumer subscription) | | Manual workflow |
| Market Movers (Sports Card Investor) | No public API found (consumer app) | | Manual workflow |
| WorthPoint | No public API found; acquired by Waverock Software 2026-02-10 | Subscription UI | Manual workflow |
| Heritage Auctions | No public API found | | Manual workflow |
| Discogs | Yes: free API; 60 req/min authenticated, 25 unauthenticated; marketplace/account resources need OAuth or personal token; price suggestions and release marketplace stats available. https://www.discogs.com/developers | Good for vinyl/CD sourcing | Adapter stub |
| BrickLink | Yes: official API (OAuth 1.0 style, token bound to IP, seller account, API Terms acceptance); price guide returns min/max/avg and sales records; 5,000 calls/day per secondary source. https://static.bricklink.com/alpha/default/api_wiki.html | Good for LEGO | Adapter stub |
| TCGplayer | Closed: "no longer granting new API access" (reported from official docs via secondary source) | | Do not implement |
| Pokemon TCG API (pokemontcg.io) | Yes, free key; Scrydex states it is the official successor and will announce legacy end-of-life. https://scrydex.com/faq | Daily market price fields, not sold comps | Adapter stub (target Scrydex) |
| Scryfall | Yes, free, no key; prices update once daily, cache at least 24 h, User-Agent and Accept headers required, use bulk data for volume. https://scryfall.com/docs/api | MTG only | Implement when needed |

### 2.10 Estate-sale and local listing sources

| Source | Official read API or feed | Finding | Decision |
|---|---|---|---|
| EstateSales.NET | No public developer API found. A partner integration exists for auction software (Wavebid) to post to EstateSales.NET with account API key, i.e., a company-side posting integration. | Do not automate reads | Manual workflow (user follows sales, email alerts the user subscribes to) |
| EstateSales.org | No API found | | Manual workflow |
| Craigslist | No public API; Terms of Use prohibit robots, spiders, scrapers, crawlers and unlicensed interoperating software. https://www.craigslist.org/about/terms.of.use/en | Explicitly prohibited | Manual workflow (URL import) |
| OfferUp | No public developer program found | | Manual workflow |
| Mercari (US) | No current public API confirmed | | Manual workflow |
| Nextdoor | Developer portal exists (ads, share/publish, embeds, search API by request form); not a for-sale listing feed for consumers. https://developer.nextdoor.com | Not fit for purpose | Do not implement |
| AuctionNinja | No official API found | | Manual workflow |
| HiBid | No official API found | | Manual workflow |
| MaxSold | No official API found (only unofficial wrappers of internal endpoints, which this project will not use) | | Manual workflow |

All of these support the same authorized pattern: user receives the site's own email/app alerts, then shares or pastes the URL into Resale Radar, optionally with a screenshot for Claude extraction.

### 2.11 Shipping rate providers

- USPS Web Tools: retired **2026-01-25** ("service disruptions are underway"). Replacement: USPS APIs on the developer portal (REST, OAuth 2.0); Web Tools credentials do not carry over. Source: https://www.usps.com/business/web-tools-apis/welcome.htm , https://developers.usps.com (verified on 2026-10-13 via search index). Cost: free API; postage at USPS rates.
- UPS: access-key auth retired in mid-2024; OAuth 2.0 client ID/secret from the UPS Developer Portal with Rating and Time in Transit products. Pricing of API access not confirmed (secondary sources only).
- EasyPost: per secondary sources, February 2026 restructuring into Free Access ($0/month, 3,000 labels/month included, then $0.08/label) and BYOCA ($20/month). Not verified on easypost.com.
- Shippo: free plan with multi-carrier rates and labels; secondary sources conflict on per-label fees and caps. Not verified on goshippo.com.
- eBay labels: buying labels in Seller Hub is free to use (postage only) with eBay-negotiated rates. The Logistics API (`createShippingQuote`, `createFromShippingQuote`) is Limited Release, US domestic, USPS only. Source: https://developer.ebay.com/api-docs/sell/logistics/resources/methods (verified on 2026-10-13 via search index). Label costs appear in Finances API transactions, so shipping cost can be reconciled automatically.
- Resale Radar decision: **Manual workflow** for label purchase (Seller Hub); **implement now** reading label costs from Finances API; **adapter stub** for USPS API rate quotes (free) to estimate shipping before buying inventory. Shippo/EasyPost only if multi-carrier comparison is needed.

### 2.12 Routing and geocoding

- Google Routes API: `computeRoutes` (billed per request) and `computeRouteMatrix` (billed per element = origins x destinations). Source: https://developers.google.com/maps/documentation/routes/usage-and-billing (verified on 2026-10-13 via search index).
- SKU tiers (one SKU charged per request, the highest triggered):
  - Essentials: basic routing. Free cap 10,000 events/month per SKU; then $5.00 per 1,000 (up to 100,000).
  - Pro: triggered by `routingPreference` TRAFFIC_AWARE or TRAFFIC_AWARE_OPTIMAL (and other advanced features). Free cap 5,000/month; then $10.00 per 1,000.
  - Enterprise: triggered by toll calculation (`extraComputations: ["TOLLS"]`) among others. Free cap 1,000/month; then $15.00 per 1,000.
  - Route matrix with TRAFFIC_AWARE_OPTIMAL is limited to 100 elements per request.
  - Sources: https://developers.google.com/maps/billing-and-pricing/pricing , https://developers.google.com/maps/billing-and-pricing/sku-details (verified on 2026-10-13 via search index; pricing table text was partly garbled in the index, see Unverified list).
- Free usage model: since 2025-03-01 Google replaced the $200 monthly credit with per-SKU monthly free caps (Essentials 10,000, Pro 5,000, Enterprise 1,000), resetting on the 1st at midnight Pacific. Source: https://developers.google.com/maps/billing-and-pricing/march-2025 (verified on 2026-10-13 via search index).
- Geocoding API: 10,000 free/month, then $5.00 per 1,000 up to 100,000; rate limit 3,000 QPM. Source: https://developers.google.com/maps/documentation/geocoding/usage-and-billing
- Mapbox Directions: pricing page shows 100,000 free requests/month then $2.00 per 1,000 (100,001 to 500,000); sign-up docs show a 10,000/month limit for accounts without a payment method. Source: https://www.mapbox.com/pricing , https://docs.mapbox.com/accounts/guides/signup/ (partially verified; pricing page age uncertain).
- OpenRouteService: free standard plan, Directions 2,000/day and 40/minute. Source: https://openrouteservice.org/plans/
- OSRM: open-source, self-hosted, no traffic or tolls; requires hosting a server with OSM extracts (not cost-free in effort).
- Resale Radar decision: **Implement now** with Google Routes. Use Essentials for most route checks, Pro (traffic-aware) only for "leave now" estimates, and avoid TOLLS (the Chicago-area I-355 tollway near Lockport makes tolls relevant, but 1,000 free Enterprise calls/month is ample if gated behind an explicit toggle). Cache geocodes. ORS as fallback adapter.

### 2.13 Notifications

- Web Push: W3C Push API + Notifications API + Service Worker with VAPID (RFC 8292) keys. On iOS/iPadOS 16.4+, only for web apps added to the Home Screen (standalone display); permission must follow a user gesture; delivered via APNs, no Apple Developer membership needed; Declarative Web Push added in iOS 18.4. Source: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ , https://webkit.org/blog/16535/meet-declarative-web-push/ (verified on 2026-10-13 via search index). Cost: free. **Implement now.**
- Email: Resend free tier 3,000 emails/month, 100/day; Pro $20/month for 50,000 (secondary sources). Postmark small free developer tier (100/month). SendGrid permanent free plan retired in 2025 (60-day trial). Not verified on vendor pages. **Implement now with Resend** (daily digest).
- Twilio SMS: US A2P 10DLC registration is required for application-to-person SMS on 10DLC numbers. Fees per Twilio: brand registration $4.50 (sole proprietor/low-volume/standard), standard brand secondary vetting $41.50, campaign vetting $15 (non-refundable), monthly campaign fee $2 (sole proprietor) to $10 (standard), plus number and per-message charges. Source: https://support.twilio.com/hc/en-us/articles/1260803965530-Pricing-and-Fees-for-A2P-10DLC-Service (verified on 2026-10-13 via search index). **Do not implement now** (Web Push covers it).
- Pushover: $4.99 one-time per platform, 30-day trial. Source: https://pushover.net/pricing (official). ntfy: open source, self-host free; hosted free tier rate-limited, paid from about $5/month (secondary). **Optional** fallback if iOS Web Push proves unreliable.

### 2.14 IRS standard mileage rate

- 2026: **72.5 cents per mile** for business miles driven 2026-01-01 through 2026-06-30 (IR-2025-128, up 2.5 cents from 2025). Source: https://www.irs.gov/newsroom/irs-sets-2026-business-standard-mileage-rate-at-725-cents-per-mile-up-25-cents (verified on 2026-10-13, official page via search index).
- 2026 mid-year change: **76 cents per mile** for business miles driven 2026-07-01 through 2026-12-31, per IRS Announcement 2026-11 (Internal Revenue Bulletin 2026-29, dated 2026-07-13), citing fuel costs. Medical/moving rose from 20.5 to 23.5 cents; charitable stays 14 cents (statutory). Reported consistently by Bloomberg Tax, CPA Practice Advisor, NATP, UHY and others; the IRS page itself (https://www.irs.gov/tax-professionals/standard-mileage-rates) could not be opened directly, so this is listed in the Unverified section for a final check.
- 2025 (reference): 70 cents per mile (implied by the IRS "up 2.5 cents" statement).
- Resale Radar decision: **Implement now** as a date-ranged config table so trips are valued by trip date (split-year 2026).

### 2.15 Anthropic API (Claude)

Source: https://platform.claude.com/docs/en/models/sonnet-5-5/overview , https://www.anthropic.com/claude/haiku , https://www.anthropic.com/claude/opus (verified on 2026-10-13 via search index), cross-checked with Anthropic's model table (cached 2026-10-06).

| Role | Model ID | Input $/1M tokens | Output $/1M tokens | Notes |
|---|---|---|---|---|
| Cheap filtering / extraction | `claude-haiku-5-5` | $0.10 (prompts up to 100K tokens) | $0.50 | $0.50 / $2.50 for prompts over 100K; effort default `medium` |
| Capable vision (screenshot/photo extraction, condition notes) | `claude-sonnet-5-5` | $2.00 | $10.00 | 1M context, 128K output |
| Highest quality (rare, e.g., authentication second opinion) | `claude-opus-5-5` | $4.00 | $20.00 | Thinking cannot be disabled; tune effort |

- Auth: API key (`x-api-key`) or OAuth profile. Batch API is 50% cheaper for non-urgent jobs. Prompt caching cuts repeated system-prompt cost.
- Notes for implementation: on Sonnet 5.5 and Opus 5.5, forced `tool_choice` (`any`/`tool`) returns 400; use structured outputs (`output_config.format`) for JSON extraction. Handle `stop_reason: "refusal"`.
- Resale Radar decision: **Implement now** (Haiku 5.5 for triage/scoring text, Sonnet 5.5 for screenshot and photo extraction).

## 3. Unverified / could not confirm

1. Full text of every official page: direct fetching was blocked; facts rely on official pages' search-index text.
2. eBay fee page effective date (no date stamp seen); whether any 2026 US fee change occurred (third-party reports of an April 2026 sneaker change to 8%).
3. eBay international fee percentage (1.65% commonly cited) not found on an official page.
4. eBay Top Rated Plus discount exact current terms (10% figure from community/older pages).
5. Basic (non-Store) table rates for Bullion, Video Game Consoles, and Guitars & Basses (seen on Store fee page), and the $7,500 vs $2,500 breakpoint for Books/Movies/Music.
6. Status of the trading-card singles $1,000+ 50% FVF promotion.
7. eBay API License Agreement current wording regarding storing eBay content and deriving price metrics (only summaries read).
8. IRS Announcement 2026-11 (76 cents from 2026-07-01) confirmed only via multiple secondary tax publications, not on irs.gov directly.
9. Google Routes per-SKU prices ($5/$10/$15 per 1,000) came from a garbled index of the pricing table; confirm in the Cloud console pricing calculator.
10. Mapbox free tier (100,000 vs 10,000 without payment method).
11. Shippo and EasyPost current plans (secondary sources only); UPS API pricing.
12. Resend, Postmark, SendGrid pricing (secondary sources only); ntfy hosted pricing.
13. Keepa plan prices (secondary); PriceCharting current plan prices (page may be dated) and whether the API now includes history.
14. PSA free-tier call limit (official docs say 100/day; a secondary source claims it was reduced).
15. TCGplayer "no new API access" statement (seen via secondary sources quoting official docs).
16. BrickLink 5,000 calls/day limit (secondary).
17. Pokemon TCG API rate limits and legacy end-of-life date.
18. Facebook Marketplace saved-search alert feature details.
19. eBay Sell Message API scope and availability.
20. Mercari US developer API status.

## 4. Recommended build order and monthly cost estimate ($1,000-bankroll reseller)

Build order:
1. Core data model plus manual capture: Marketplace URL import, PWA Web Share Target, screenshot upload with Claude Sonnet 5.5 extraction, Claude Haiku 5.5 deal scoring.
2. Static config tables: eBay US fee schedule (versioned, with last-verified date), IRS mileage rates by date range, per-item profit calculator (buy price, fees, shipping estimate, mileage).
3. eBay Browse API (app token): active comps and local-pickup search around 60441 within the 5,000/day limit (cache results).
4. eBay OAuth (user token, refresh token rotation and re-consent reminder before 18 months): Fulfillment + Finances read-only for realized sales, actual fees, label costs, payouts.
5. Google Routes + Geocoding: trip planning for pickups and estate sales, mileage logging (Essentials by default, traffic-aware on demand, tolls behind a toggle).
6. Notifications: Web Push (VAPID) plus Resend daily digest.
7. Manual sold-comp workflow: deep links to Seller Hub Product Research and category-specific sites; user records comps.
8. Optional adapters as niches emerge: Discogs, BrickLink, Scryfall, Scrydex/Pokemon TCG, PSA cert lookup, USPS API rate quotes, PriceCharting (paid), eBay Negotiation API.
9. Stubs only (awaiting approval that is unlikely): Marketplace Insights, Buy Offer API, Logistics API.

Monthly cost estimate (personal usage):

| Item | Assumed usage | Est. cost/month |
|---|---|---|
| eBay APIs (Browse, Sell) | well under limits | $0 |
| Google Routes + Geocoding | under 10,000 Essentials / 5,000 Pro / 1,000 Enterprise per SKU | $0 |
| Claude Haiku 5.5 triage | about 3,000 items x 1,500 input + 100 output tokens | about $0.60 |
| Claude Sonnet 5.5 vision | about 300 screenshots x 2,500 input + 500 output tokens | about $3.00 |
| Web Push | | $0 |
| Resend email | under 3,000/month | $0 |
| Pushover (optional) | one-time $4.99 | $0 recurring |
| Hosting/database | free tiers assumed (not researched here) | $0 to $25 |
| PriceCharting Legendary (optional) | only if video games/cards are core | $49 |
| **Total recommended baseline** | | **about $4 to $10/month** (plus hosting if it exceeds free tiers) |

Keep paid data subscriptions off until the realized-profit data from the Finances API shows a niche where they pay for themselves (for example, PriceCharting at $49/month should be justified by at least that much extra margin per month).
