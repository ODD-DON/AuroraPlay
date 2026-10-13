import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { allocateCapital } from "@/domain/capital";
import { profitAtPrice } from "@/domain/evaluate";
import { dollarsToCents, formatCents } from "@/domain/money";
import { buildSearchRings } from "@/domain/searchTiers";
import {
  aiConfigured, extractListingFromScreenshot, identifyListing, IDENTIFY_PROMPT_VERSION, runAdvisor, SCREENSHOT_PROMPT_VERSION,
  MODELS, costMicrodollars, type AdvisorTool, type IdentifyOutput, type ImageInput,
} from "@/integrations/ai";
import { countActiveListings, ebayConfigured, searchActive } from "@/integrations/ebay";
import { IntegrationError } from "@/integrations/http";
import { computeRoute, routingConfigured, ROUTE_COST_MICRODOLLARS } from "@/integrations/routing";
import { num, type Queryable } from "@/server/db";
import { readObject } from "@/server/storage";
import { audit, createAlert, getBuyingPower, getFinancialSummary, getSettings, monthToDateUsage, recordUsage } from "./core";
import { getOpportunityDetail, importListing, listFeed, reevaluate } from "./opportunities";
import { addCandidate, recordRoute } from "./research";
import { listInventory } from "./inventory";

/* --------------------------------- budget --------------------------------- */

export async function softwareSpendThisMonthCents(q: Queryable, ownerId: string): Promise<number> {
  const usage = await monthToDateUsage(q, ownerId);
  return Math.round(usage.reduce((a, u) => a + u.costMicrodollars, 0) / 10_000);
}

async function assertBudget(q: Queryable, ownerId: string) {
  const { settings } = await getSettings(q, ownerId);
  const spent = await softwareSpendThisMonthCents(q, ownerId);
  if (spent >= settings.monthlySoftwareBudgetCents) {
    throw new IntegrationError("budget", `Monthly software budget of ${formatCents(settings.monthlySoftwareBudgetCents)} reached (${formatCents(spent)} spent). Raise it in Settings or research manually.`);
  }
}

async function recordIntegrationError(q: Queryable, ownerId: string, provider: string, e: unknown) {
  const message = (e as Error).message ?? String(e);
  await q.query(`insert into integration_errors (owner_id, provider, message) values ($1,$2,$3)`, [ownerId, provider, message.slice(0, 1000)]);
  await q.query(
    `insert into data_source_status (owner_id, provider, healthy, detail, checked_at) values ($1,$2,false,$3,now())
     on conflict (owner_id, provider) do update set healthy = false, detail = excluded.detail, checked_at = now()`,
    [ownerId, provider, message.slice(0, 300)],
  );
}

async function markHealthy(q: Queryable, ownerId: string, provider: string) {
  await q.query(
    `insert into data_source_status (owner_id, provider, healthy, detail, checked_at) values ($1,$2,true,'Last call succeeded',now())
     on conflict (owner_id, provider) do update set healthy = true, detail = 'Last call succeeded', checked_at = now()`,
    [ownerId, provider],
  );
}

/* ------------------------------ identification ------------------------------ */

async function loadImages(q: Queryable, listingId: string): Promise<{ images: ImageInput[]; hashes: string[]; ids: string[] }> {
  const rows = await q.query<{ id: string; storage_path: string | null; sha256: string | null }>(
    `select id, storage_path, sha256 from listing_images where listing_id = $1 and storage_path is not null order by position, created_at limit 8`,
    [listingId],
  );
  const images: ImageInput[] = [];
  for (const r of rows) images.push({ base64: (await readObject(r.storage_path!)).toString("base64"), mediaType: "image/jpeg" });
  return { images, hashes: rows.map((r) => r.sha256 ?? r.id), ids: rows.map((r) => r.id) };
}

export async function identifyWithAi(q: Queryable, ownerId: string, opportunityId: string) {
  if (!aiConfigured()) throw new IntegrationError("anthropic", "AI identification needs ANTHROPIC_API_KEY. You can still record identity hypotheses manually.");
  const d = await getOpportunityDetail(q, ownerId, opportunityId);
  if (!d || !d.listing) throw new Error("Listing not found");
  const { images, hashes, ids } = await loadImages(q, d.listing.id);
  if (!images.length && !d.listing.description) throw new Error("Add at least one photo or a description before running AI identification.");

  const inputHash = crypto.createHash("sha256").update(JSON.stringify([IDENTIFY_PROMPT_VERSION, MODELS.deep, d.listing.title, d.listing.description, d.opportunity.asking_price_cents, hashes])).digest("hex");
  const [cached] = await q.query<{ id: string; output: IdentifyOutput }>(
    `select id, output from ai_analysis_runs where owner_id = $1 and kind = 'identify' and input_hash = $2 and status = 'succeeded' order by finished_at desc limit 1`,
    [ownerId, inputHash],
  );
  let output: IdentifyOutput;
  let runId: string;
  if (cached) {
    output = cached.output;
    const [r] = await q.query<{ id: string }>(
      `insert into ai_analysis_runs (owner_id, listing_id, opportunity_id, kind, model, status, prompt_version, input_hash, output, finished_at) values ($1,$2,$3,'identify',$4,'cached',$5,$6,$7,now()) returning id`,
      [ownerId, d.listing.id, opportunityId, MODELS.deep, IDENTIFY_PROMPT_VERSION, inputHash, output],
    );
    runId = r!.id;
  } else {
    await assertBudget(q, ownerId);
    try {
      const res = await identifyListing({ title: d.listing.title, description: d.listing.description, askingPriceCents: d.opportunity.asking_price_cents, locationText: d.listing.location_text, images });
      output = res.parsed;
      const [r] = await q.query<{ id: string }>(
        `insert into ai_analysis_runs (owner_id, listing_id, opportunity_id, kind, model, status, prompt_version, input_hash, input_tokens, output_tokens, cost_microdollars, output, finished_at)
         values ($1,$2,$3,'identify',$4,'succeeded',$5,$6,$7,$8,$9,$10,now()) returning id`,
        [ownerId, d.listing.id, opportunityId, res.model, IDENTIFY_PROMPT_VERSION, inputHash, res.inputTokens, res.outputTokens, res.costMicrodollars, output],
      );
      runId = r!.id;
      await recordUsage(q, ownerId, "anthropic", "identify", res.costMicrodollars, 1, { model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens });
      await markHealthy(q, ownerId, "anthropic");
    } catch (e) {
      await recordIntegrationError(q, ownerId, "anthropic", e);
      throw e;
    }
  }
  await applyIdentification(q, ownerId, opportunityId, d.listing.id, d.opportunity.asking_price_cents, output, runId, ids);
  return output;
}

/** Stores AI hypotheses. AI never marks identity verified; that requires the owner. */
export async function applyIdentification(q: Queryable, ownerId: string, opportunityId: string, listingId: string, askingCents: number, out: IdentifyOutput, runId: string, imageIds: string[]) {
  await q.query(`delete from item_identity_candidates where opportunity_id = $1 and source = 'ai' and status = 'hypothesis'`, [opportunityId]);
  await q.query(`delete from detected_objects where listing_id = $1 and ai_run_id is not null and status = 'candidate'`, [listingId]);
  const clamp01 = (n: number | null) => (n === null ? null : Math.max(0, Math.min(1, n)));
  let topConfidence = 0;
  let maxHigh = 0;
  for (const obj of out.objects.slice(0, 15)) {
    const imageId = obj.image_index != null ? imageIds[Math.round(obj.image_index)] ?? null : null;
    const [det] = await q.query<{ id: string }>(
      `insert into detected_objects (owner_id, listing_id, image_id, label, research_priority, ai_run_id) values ($1,$2,$3,$4,$5,$6) returning id`,
      [ownerId, listingId, imageId, obj.label.slice(0, 300), Math.max(0, Math.min(100, Math.round(obj.research_priority))), runId],
    );
    for (const c of obj.candidates.slice(0, 3)) {
      const conf = clamp01(c.identification_confidence) ?? 0;
      topConfidence = Math.max(topConfidence, conf);
      const low = c.speculative_value_low_usd != null && c.speculative_value_low_usd > 0 ? dollarsToCents(c.speculative_value_low_usd) : null;
      const high = c.speculative_value_high_usd != null && c.speculative_value_high_usd > 0 ? dollarsToCents(c.speculative_value_high_usd) : null;
      if (high) maxHigh = Math.max(maxHigh, high);
      const id = await addCandidate(q, ownerId, opportunityId, {
        productName: c.product_name.slice(0, 300),
        brand: c.brand?.slice(0, 120) ?? null,
        model: c.model?.slice(0, 120) ?? null,
        variant: c.variant?.slice(0, 200) ?? null,
        manufacturingPeriod: c.manufacturing_period?.slice(0, 80) ?? null,
        identificationConfidence: conf,
        rationale: [c.supporting_features.length ? `Supports: ${c.supporting_features.join("; ")}` : null, c.search_query ? `Search: ${c.search_query}` : null].filter(Boolean).join("\n").slice(0, 2000) || null,
      }, "ai", runId);
      await q.query(
        `update item_identity_candidates set detected_object_id = $2, listing_id = $3, category = $4, variant_confidence = $5, authenticity_concerns = $6,
           potential_value_low_cents = $7, potential_value_high_cents = $8, required_photos = $9 where id = $1`,
        [id, det!.id, listingId, c.category, clamp01(c.variant_confidence), c.authenticity_concerns?.slice(0, 1000) ?? null, low, high, c.required_photos.slice(0, 10)],
      );
      for (const f of c.supporting_features.slice(0, 8)) await q.query(`insert into identity_evidence (owner_id, candidate_id, kind, description, supports) values ($1,$2,'visual_feature',$3,true)`, [ownerId, id, f.slice(0, 500)]);
      for (const f of c.conflicting_evidence.slice(0, 8)) await q.query(`insert into identity_evidence (owner_id, candidate_id, kind, description, supports) values ($1,$2,'conflict',$3,false)`, [ownerId, id, f.slice(0, 500)]);
    }
  }
  const hiddenGem = out.hidden_gem_signals.length > 0 && (out.is_lot || maxHigh >= askingCents * 2.5);
  await q.query(
    `update opportunities set
       category = coalesce(category, $2),
       identity_status = case when identity_status = 'verified' then identity_status when $3 >= 0.8 then 'probable' else identity_status end,
       identity_confidence = case when identity_status = 'verified' then identity_confidence else $3 end,
       condition_confidence = case when condition_confidence = 0.5 then $4 else condition_confidence end,
       hidden_gem_flag = hidden_gem_flag or $5,
       hidden_gem_rationale = coalesce($6, hidden_gem_rationale),
       hidden_gem_potential_high_cents = coalesce(nullif($7, 0), hidden_gem_potential_high_cents),
       updated_at = now()
     where id = $1`,
    [opportunityId, out.suggested_category, topConfidence, Math.max(0, Math.min(1, out.condition_confidence)), hiddenGem, out.hidden_gem_rationale?.slice(0, 2000) ?? null, maxHigh],
  );
  for (const flag of out.red_flags.slice(0, 5)) {
    if (/deposit|gift card|wire|zelle before|pay before/i.test(flag)) {
      await q.query(
        `insert into opportunity_risk_factors (owner_id, opportunity_id, code, severity, title, detail, source) values ($1,$2,'suspicious_payment','critical','Unusual payment request',$3,'ai') on conflict do nothing`,
        [ownerId, opportunityId, flag.slice(0, 500)],
      );
    }
  }
  await audit(q, ownerId, "ai.identification_applied", "opportunity", opportunityId, { objects: out.objects.length, hiddenGem }, "ai");
  await reevaluate(q, ownerId, opportunityId);
}

export async function screenshotToListing(q: Queryable, ownerId: string, image: ImageInput, sha256: string) {
  if (!aiConfigured()) throw new IntegrationError("anthropic", "Screenshot reading needs ANTHROPIC_API_KEY. Enter the details manually instead.");
  await assertBudget(q, ownerId);
  const inputHash = crypto.createHash("sha256").update(`${SCREENSHOT_PROMPT_VERSION}:${MODELS.fast}:${sha256}`).digest("hex");
  try {
    const res = await extractListingFromScreenshot(image);
    await q.query(
      `insert into ai_analysis_runs (owner_id, kind, model, status, prompt_version, input_hash, input_tokens, output_tokens, cost_microdollars, output, finished_at)
       values ($1,'screenshot_extract',$2,'succeeded',$3,$4,$5,$6,$7,$8,now())`,
      [ownerId, res.model, SCREENSHOT_PROMPT_VERSION, inputHash, res.inputTokens, res.outputTokens, res.costMicrodollars, res.parsed],
    );
    await recordUsage(q, ownerId, "anthropic", "screenshot_extract", res.costMicrodollars);
    return res.parsed;
  } catch (e) {
    await recordIntegrationError(q, ownerId, "anthropic", e);
    throw e;
  }
}

/* ---------------------------------- routes ---------------------------------- */

export async function computeRouteForOpportunity(q: Queryable, ownerId: string, opportunityId: string, destination: string, precision: "exact" | "approximate") {
  if (!routingConfigured()) throw new IntegrationError("google_routes", "Automatic drive times need GOOGLE_MAPS_API_KEY. Enter the drive time manually instead.");
  await assertBudget(q, ownerId);
  const { settings } = await getSettings(q, ownerId);
  const origin = settings.homeLatitude != null && settings.homeLongitude != null ? { latitude: settings.homeLatitude, longitude: settings.homeLongitude } : { address: settings.homeLabel };
  try {
    const r = await computeRoute(origin, { address: destination.slice(0, 300) });
    await recordUsage(q, ownerId, "google_routes", "computeRoutes", ROUTE_COST_MICRODOLLARS);
    await markHealthy(q, ownerId, "google_routes");
    // Store only the response summary; the raw response contains no personal data but is large.
    return recordRoute(q, ownerId, opportunityId, {
      source: "google_routes", precision, trafficAware: r.trafficAware, oneWayMinutes: r.oneWayMinutes, oneWayMiles: r.oneWayMiles,
      tollsCents: r.tollsCents, destinationText: destination, raw: { computedWith: "routes.v2" },
    });
  } catch (e) {
    await recordIntegrationError(q, ownerId, "google_routes", e);
    throw e;
  }
}

/* -------------------------------- watchlists -------------------------------- */

const LOCKPORT_ZIP = "60441";

/** Runs one eBay watchlist search across due rings. Cheap filter first; analysis only for promising items. */
export async function runWatchlist(q: Queryable, ownerId: string, profileId: string) {
  const [p] = await q.query<Record<string, unknown>>(`select * from search_profiles where id = $1 and owner_id = $2 and active`, [profileId, ownerId]);
  if (!p) return { skipped: "inactive" };
  if (!ebayConfigured()) {
    await q.query(`insert into search_executions (owner_id, search_profile_id, source, status, error, finished_at) values ($1,$2,'ebay','skipped','eBay credentials not configured',now())`, [ownerId, profileId]);
    return { skipped: "ebay_not_configured" };
  }
  const { settings } = await getSettings(q, ownerId);
  const rings = buildSearchRings(settings.travel.tiers, Math.min(settings.travel.maxTravelMinutes, num(p.max_travel_minutes) || settings.travel.maxTravelMinutes));
  const keywords = ((p.keywords as string[]) ?? []).join(" ").trim() || String(p.name);
  const exclusions = ((p.exclusions as string[]) ?? []).map((e) => e.toLowerCase());
  const widest = rings[rings.length - 1]!;
  const [exec] = await q.query<{ id: string }>(`insert into search_executions (owner_id, search_profile_id, source, ring_tier, status) values ($1,$2,'ebay',$3,'running') returning id`, [ownerId, profileId, widest.tierId]);
  try {
    const { items } = await searchActive({
      keywords,
      minPriceCents: (p.min_price_cents as number) ?? null,
      maxPriceCents: (p.max_price_cents as number) ?? null,
      pickupPostalCode: LOCKPORT_ZIP,
      pickupRadiusMiles: widest.approxRadiusMiles,
      limit: 50,
    });
    await recordUsage(q, ownerId, "ebay_browse", "item_summary.search", 0);
    let created = 0;
    for (const item of items) {
      if (exclusions.some((x) => item.title.toLowerCase().includes(x))) continue;
      const [seen] = await q.query(`select 1 from source_listings where owner_id = $1 and source = 'ebay' and external_id = $2`, [ownerId, item.externalId]);
      await importListing(q, ownerId, { ...item, category: ((p.categories as string[]) ?? [])[0] ?? null });
      if (!seen) created++;
    }
    await q.query(`update search_executions set status = 'succeeded', results_count = $2, new_count = $3, finished_at = now() where id = $1`, [exec!.id, items.length, created]);
    await markHealthy(q, ownerId, "ebay_browse");
    return { results: items.length, created };
  } catch (e) {
    await q.query(`update search_executions set status = 'failed', error = $2, finished_at = now() where id = $1`, [exec!.id, (e as Error).message.slice(0, 500)]);
    await recordIntegrationError(q, ownerId, "ebay_browse", e);
    await createAlert(q, ownerId, { kind: "data_source_failure", priority: "normal", title: "eBay search failed", body: (e as Error).message.slice(0, 300), link: "/settings/integrations", dedupeKey: `ebayfail:${new Date().toISOString().slice(0, 13)}` });
    throw e;
  }
}

export async function lookupActiveCount(q: Queryable, ownerId: string, keywords: string) {
  if (!ebayConfigured()) throw new IntegrationError("ebay_browse", "Active listing counts need eBay API credentials. Enter the count from eBay search manually.");
  const n = await countActiveListings(keywords);
  await recordUsage(q, ownerId, "ebay_browse", "item_summary.count", 0);
  return n;
}


/* ---------------------------------- advisor --------------------------------- */

export async function askAdvisor(q: Queryable, ownerId: string, question: string, history: { role: "user" | "assistant"; content: string }[]) {
  if (!aiConfigured()) throw new IntegrationError("anthropic", "The AI Advisor needs ANTHROPIC_API_KEY.");
  await assertBudget(q, ownerId);
  const { settings } = await getSettings(q, ownerId);
  const tools: AdvisorTool[] = [
    {
      name: "search_deals",
      description: "List evaluated deals. Filters: decision (STRONG_BUY, WORTH_THE_DRIVE, BUY_IF_NEGOTIATED, HIDDEN_GEM, RESEARCH_REQUIRED, ACTIONABLE), max one-way drive minutes, open only.",
      input: z.object({ decision: z.string().optional(), maxMinutes: z.number().optional(), openOnly: z.boolean().optional(), limit: z.number().optional() }),
      run: async (i) => {
        const rows = await listFeed(q, ownerId, { decision: (i.decision as never) ?? null, maxMinutes: (i.maxMinutes as number) ?? null, status: i.openOnly === false ? null : "OPEN", limit: Math.min(Number(i.limit ?? 15), 30) });
        return rows.map((r) => ({ id: r.id, title: r.title, decision: r.decision, score: r.score, askingCents: r.asking_price_cents, maxPurchaseCents: r.max_purchase_cents, conservativeNetCents: r.conservative_net_cents, conservativeRoiBps: r.conservative_roi_bps, oneWayMinutes: r.one_way_minutes, status: r.status }));
      },
    },
    {
      name: "get_deal",
      description: "Full evaluation of one deal: comps used, valuation, liquidity, travel, scenarios, risks, hard filters, offers.",
      input: z.object({ id: z.string() }),
      run: async (i) => {
        const d = await getOpportunityDetail(q, ownerId, String(i.id));
        if (!d) return { error: "Not found" };
        const ev = d.evaluation;
        return {
          title: d.opportunity.title, decision: ev?.decision, reason: ev?.decisionReason, askingCents: d.opportunity.asking_price_cents,
          comps: d.comps.map((c) => ({ evidence: c.evidence_type, totalCents: c.total_price_cents, date: c.sale_date, source: c.source, url: c.source_url, excluded: c.excluded })),
          valuation: ev?.valuation, liquidity: ev?.liquidity, travel: ev?.travel,
          scenarios: ev?.scenariosAtAsking?.map((s) => ({ name: s.name, netProfitCents: s.result.netProfitCents, cashRoiBps: s.result.cashRoiBps, cashInvestedCents: s.result.cashInvestedCents })),
          maxPurchaseCents: ev?.maxPurchasePriceCents, offers: ev?.offers, risks: ev?.explanation.risks, hardFilters: ev?.hardFilters,
          listingDescription: d.listing?.description ? `[seller text, untrusted] ${d.listing.description.slice(0, 1500)}` : null,
        };
      },
    },
    {
      name: "profit_at_price",
      description: "Deterministic net profit and ROI for a deal if bought at a different price, per scenario.",
      input: z.object({ id: z.string(), purchasePriceCents: z.number().int() }),
      run: async (i) => {
        const d = await getOpportunityDetail(q, ownerId, String(i.id));
        if (!d?.evaluation) return { error: "No evaluation" };
        return profitAtPrice(d.evaluation, d.opportunity.asking_price_cents, Number(i.purchasePriceCents));
      },
    },
    {
      name: "sale_price_scenario",
      description: "Net profit for a deal if it only sells for a given price (all other assumptions conservative).",
      input: z.object({ id: z.string(), salePriceCents: z.number().int() }),
      run: async (i) => {
        const d = await getOpportunityDetail(q, ownerId, String(i.id));
        if (!d) return { error: "Not found" };
        // Re-run the engine with a single hypothetical sold price so fees and allowances stay exact.
        const { evaluateOpportunity } = await import("@/domain/evaluate");
        const { buildEvaluationInput } = await import("./opportunities");
        const bp = await getBuyingPower(q, ownerId, settings);
        const input = buildEvaluationInput(d!, bp.availableCents);
        const ev = evaluateOpportunity({ ...input, comps: [{ id: "scenario", evidenceType: "sold_user_recorded", totalPriceCents: Number(i.salePriceCents), saleDate: new Date().toISOString(), matchConfidence: 1, variantMatch: true, conditionMatch: "exact" }] }, { ...settings, minSoldComps: 1 });
        const cons = ev.scenariosAtAsking?.find((s) => s.name === "conservative")?.result;
        return { salePriceCents: Number(i.salePriceCents), netProfitCents: cons?.netProfitCents ?? null, cashRoiBps: cons?.cashRoiBps ?? null, note: "Single hypothetical sale price; conservative expense assumptions." };
      },
    },
    {
      name: "financial_summary",
      description: "Current cash, inventory at cost, realized revenue and profit, equity, buying power, reserve, and progress toward the $30,000 goal.",
      input: z.object({}),
      run: async () => {
        const bp = await getBuyingPower(q, ownerId, settings);
        return { ...bp.summary, buyingPowerCents: bp.availableCents, reserveCents: bp.reserveCents, committedCents: bp.committedCents, goalCents: 3_000_000, startingCapitalCents: settings.startingCapitalCents };
      },
    },
    {
      name: "can_afford",
      description: "Given deal ids, choose the best combination within buying power and exposure limits (deterministic allocator).",
      input: z.object({ ids: z.array(z.string()).max(20) }),
      run: async (i) => {
        const bp = await getBuyingPower(q, ownerId, settings);
        const cands = [];
        for (const id of i.ids as string[]) {
          const d = await getOpportunityDetail(q, ownerId, id);
          const c = d?.evaluation?.scenariosAtAsking?.find((s) => s.name === "conservative")?.result;
          if (!d || !c) continue;
          cands.push({ id, label: d.opportunity.title, cashRequiredCents: c.cashInvestedCents, conservativeNetCents: c.netProfitCents, expectedDaysToCash: d.evaluation?.liquidity.daysToSellBase ?? null, speculative: d.opportunity.decision === "HIDDEN_GEM", category: d.opportunity.category });
        }
        return { buyingPowerCents: bp.availableCents, ...allocateCapital(cands, { buyingPowerCents: bp.availableCents, equityCents: bp.summary.equityCents, maxSingleItemExposureBps: settings.maxSingleItemExposureBps, maxSpeculativeExposureBps: settings.maxSpeculativeExposureBps, existingSpeculativeCents: 0 }) };
      },
    },
    {
      name: "inventory_status",
      description: "Unsold and sold inventory with age, cost basis, list price, and realized profit.",
      input: z.object({}),
      run: async () => (await listInventory(q, ownerId)).map((i) => ({ id: i.id, name: i.name, category: i.category, status: i.status, ageDays: i.age_days, costBasisCents: i.cost_basis_cents, listPriceCents: i.listing_price_cents, profitCents: i.actual_profit_cents, soldAt: i.sold_at })),
    },
    {
      name: "profit_by_period",
      description: "Realized operating profit and revenue between two ISO dates (inclusive end).",
      input: z.object({ from: z.string(), to: z.string() }),
      run: async (i) => {
        const end = await getFinancialSummary(q, ownerId, new Date(String(i.to)));
        const start = await getFinancialSummary(q, ownerId, new Date(new Date(String(i.from)).getTime() - 1));
        return { revenueCents: end.netRevenueCents - start.netRevenueCents, netOperatingProfitCents: end.netOperatingProfitCents - start.netOperatingProfitCents };
      },
    },
  ];
  const result = await runAdvisor({
    question,
    history,
    tools,
    onUsage: async (model, inT, outT) => recordUsage(q, ownerId, "anthropic", "advisor", costMicrodollars(model, inT, outT), 1, { model, inputTokens: inT, outputTokens: outT }),
  });
  await audit(q, ownerId, "advisor.asked", "advisor", null, { question: question.slice(0, 200), tools: result.toolCalls.map((t) => t.name) }, "ai");
  return result;
}

export function aiStatus() {
  return { ai: aiConfigured(), routing: routingConfigured(), ebay: ebayConfigured() };
}

