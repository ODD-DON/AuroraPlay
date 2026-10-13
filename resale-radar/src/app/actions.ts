"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/components/action-form";
import { dollarsToCents, percentToBps } from "@/domain/money";
import { ALL_CATEGORIES, DEFAULT_SETTINGS, type BusinessSettings } from "@/domain/settings";
import type { AccountCode } from "@/domain/ledger";
import { asOwner } from "@/server/auth";
import { storeImage } from "@/server/storage";
import { saveSettings, getSettings } from "@/server/services/core";
import { importListing, reevaluate, type ImportListingInput } from "@/server/services/opportunities";
import {
  addCandidate, addComparable, addIdentityEvidence, addRiskFactor, deleteComparable, recordDecision, recordLiquidity, recordRoute,
  resolveRiskFactor, reviewCandidate, setComparableExcluded, updateFacts,
} from "@/server/services/research";
import { closeNegotiation, markAgreed, markMessageSent, recordSellerReply, startNegotiation, updateDraft } from "@/server/services/negotiation";
import {
  addInventoryCost, markPurchased, markShipped, recordContribution, recordExpense, recordReturn, recordSale, recordWithdrawal,
  updateInventoryStatus, upsertSaleListing, writeOff, type InventoryStatus,
} from "@/server/services/inventory";
import { deleteWatchlist, planPickupTrip, saveWatchlist } from "@/server/services/planning";
import { askAdvisor, computeRouteForOpportunity, identifyWithAi, lookupActiveCount, runWatchlist, screenshotToListing } from "@/server/services/automation";

/* --------------------------------- helpers --------------------------------- */

function str(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function money(fd: FormData, k: string, required = false): number | null {
  const v = str(fd, k);
  if (v === null) {
    if (required) throw new Error(`${k.replace(/([A-Z])/g, " $1").toLowerCase()} is required`);
    return null;
  }
  const cents = dollarsToCents(v);
  if (cents < 0) throw new Error("Amounts cannot be negative");
  return cents;
}

function int(fd: FormData, k: string): number | null {
  const v = str(fd, k);
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${k}`);
  return Math.round(n);
}

function decimal(fd: FormData, k: string): number | null {
  const v = str(fd, k);
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${k}`);
  return n;
}

function bool(fd: FormData, k: string): boolean {
  const v = fd.get(k);
  return v === "on" || v === "true" || v === "1";
}

function uuid(fd: FormData, k: string): string {
  const v = str(fd, k);
  if (!v || !/^[0-9a-f-]{36}$/i.test(v)) throw new Error("Missing or invalid id");
  return v;
}

async function act(fn: () => Promise<unknown>, paths: string[] = []): Promise<ActionResult> {
  try {
    const out = await fn();
    const r: ActionResult = out && typeof out === "object" && "ok" in out ? (out as ActionResult) : { ok: true };
    for (const p of paths) revalidatePath(p);
    // Navigate on the server: the submitting form may unmount once the data changes.
    if (r.ok && r.redirectTo) redirect(r.redirectTo);
    return r;
  } catch (e) {
    // Let Next.js redirects (e.g. an expired session sent to /login) propagate.
    if (typeof (e as { digest?: unknown })?.digest === "string" && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof z.ZodError) return { ok: false, error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
    const msg = (e as Error).message ?? "Something went wrong";
    // Never leak SQL internals to the client.
    if (/violates|syntax error|relation "|column "/i.test(msg)) return { ok: false, error: "That change could not be saved. Check the values and try again." };
    return { ok: false, error: msg };
  }
}

const dealPaths = (id: string) => [`/deals/${id}`, `/gems/${id}`, "/radar", "/", "/gems", `/negotiations/${id}`, "/negotiations"];

/* -------------------------------- onboarding -------------------------------- */

export async function completeOnboardingAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const result = await act(async () => {
    const s: BusinessSettings = structuredClone(DEFAULT_SETTINGS);
    s.homeLabel = str(fd, "homeLabel") ?? s.homeLabel;
    s.startingCapitalCents = money(fd, "startingCapital", true)!;
    s.travel.tiers[0]!.minNetProfitCents = money(fd, "minNetProfit") ?? s.travel.tiers[0]!.minNetProfitCents;
    s.minCashRoiBps = percentToBps(decimal(fd, "minRoi") ?? 25);
    s.travel.localAreaMinutes = int(fd, "localAreaMinutes") ?? 20;
    s.travel.maxTravelMinutes = int(fd, "maxTravelMinutes") ?? 90;
    s.allowExceptionalTravel = bool(fd, "allowExceptionalTravel");
    s.riskTolerance = (str(fd, "riskTolerance") as BusinessSettings["riskTolerance"]) ?? "conservative";
    s.monthlySoftwareBudgetCents = money(fd, "monthlyBudget") ?? s.monthlySoftwareBudgetCents;
    s.maxSingleItemExposureBps = percentToBps(decimal(fd, "maxSingleItemPct") ?? 40);
    const cats = fd.getAll("categories").filter((c): c is string => typeof c === "string" && (ALL_CATEGORIES as readonly string[]).includes(c));
    s.enabledCategories = cats.length ? cats : [...ALL_CATEGORIES];
    s.negotiationMode = "approval";
    await asOwner(async (q, owner) => {
      await saveSettings(q, owner, s, true);
      await q.query(
        `insert into user_preferences (owner_id, notification_channels) values ($1, $2) on conflict (owner_id) do update set notification_channels = excluded.notification_channels`,
        [owner, { in_app: true, email: bool(fd, "notifyEmail"), push: bool(fd, "notifyPush"), sms: false }],
      );
    });
  }, ["/"]);
  if (result.ok) redirect("/radar?welcome=1");
  return result;
}

/* --------------------------------- settings --------------------------------- */

export async function saveSettingsAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    await asOwner(async (q, owner) => {
      const { settings, onboardingCompleted } = await getSettings(q, owner);
      const s = structuredClone(settings);
      s.homeLabel = str(fd, "homeLabel") ?? s.homeLabel;
      const lat = decimal(fd, "homeLatitude");
      const lng = decimal(fd, "homeLongitude");
      s.homeLatitude = lat;
      s.homeLongitude = lng;
      s.minCashRoiBps = percentToBps(decimal(fd, "minRoi") ?? s.minCashRoiBps / 100);
      s.cashReserveBps = percentToBps(decimal(fd, "cashReservePct") ?? s.cashReserveBps / 100);
      s.maxSingleItemExposureBps = percentToBps(decimal(fd, "maxSingleItemPct") ?? s.maxSingleItemExposureBps / 100);
      s.maxSpeculativeExposureBps = percentToBps(decimal(fd, "maxSpeculativePct") ?? s.maxSpeculativeExposureBps / 100);
      s.preferredHorizonDays = int(fd, "preferredHorizonDays") ?? s.preferredHorizonDays;
      s.minSoldComps = int(fd, "minSoldComps") ?? s.minSoldComps;
      s.buyerSalesTaxBps = percentToBps(decimal(fd, "buyerSalesTaxPct") ?? s.buyerSalesTaxBps / 100);
      s.defaultPackagingCents = money(fd, "defaultPackaging") ?? s.defaultPackagingCents;
      s.defaultHandlingMinutes = int(fd, "defaultHandlingMinutes") ?? s.defaultHandlingMinutes;
      s.defaultReturnsAllowanceBps = percentToBps(decimal(fd, "returnsPct") ?? s.defaultReturnsAllowanceBps / 100);
      s.monthlySoftwareBudgetCents = money(fd, "monthlyBudget") ?? s.monthlySoftwareBudgetCents;
      s.allowExceptionalTravel = bool(fd, "allowExceptionalTravel");
      s.sellerAdjustments.topRatedDiscountBps = bool(fd, "topRated") ? 1_000 : 0;
      s.sellerAdjustments.promotedRateBps = percentToBps(decimal(fd, "promotedPct") ?? 0);
      s.travel.localAreaMinutes = int(fd, "localAreaMinutes") ?? s.travel.localAreaMinutes;
      s.travel.maxTravelMinutes = int(fd, "maxTravelMinutes") ?? s.travel.maxTravelMinutes;
      s.travel.defaultPickupMinutes = int(fd, "defaultPickupMinutes") ?? s.travel.defaultPickupMinutes;
      s.travel.wastedTripRateBps = percentToBps(decimal(fd, "wastedTripPct") ?? s.travel.wastedTripRateBps / 100);
      s.travel.ownerHourlyValueCents = money(fd, "ownerHourlyValue") ?? s.travel.ownerHourlyValueCents;
      s.travel.minProfitPerHourOutsideLocalCents = money(fd, "minProfitPerHour") ?? s.travel.minProfitPerHourOutsideLocalCents;
      const method = str(fd, "vehicleMethod");
      if (method === "actual_expense") {
        s.travel.vehicle = {
          method: "actual_expense",
          fuelPriceCentsPerGallon: money(fd, "fuelPrice") ?? 350,
          milesPerGallon: decimal(fd, "mpg") ?? 25,
          maintenanceCentsPerMile: decimal(fd, "maintenanceCpm") ?? 10,
          depreciationCentsPerMile: decimal(fd, "depreciationCpm") ?? 15,
        };
      } else {
        s.travel.vehicle = { method: "mileage_rate", rateCentsPerMile: decimal(fd, "mileageRateCents") ?? 76 };
      }
      s.travel.tiers = s.travel.tiers.map((t) => ({
        ...t,
        maxOneWayMinutes: t.maxOneWayMinutes === null ? null : int(fd, `tier_${t.id}_max`) ?? t.maxOneWayMinutes,
        minNetProfitCents: money(fd, `tier_${t.id}_min`) ?? t.minNetProfitCents,
      }));
      await saveSettings(q, owner, s, onboardingCompleted);
      const opps = await q.query<{ id: string }>(`select id from opportunities where status not in ('sold','passed','expired','sold_by_other','duplicate','unavailable') order by updated_at desc limit 200`);
      for (const o of opps) await reevaluate(q, owner, o.id, s);
    });
    return { ok: true, message: "Settings saved. Open deals were re-evaluated with the new rules." };
  }, ["/settings", "/radar", "/"]);
}

export async function savePreferencesAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    await asOwner((q, owner) =>
      q.query(
        `insert into user_preferences (owner_id, quiet_hours_start, quiet_hours_end, notification_channels, updated_at) values ($1,$2,$3,$4,now())
         on conflict (owner_id) do update set quiet_hours_start = excluded.quiet_hours_start, quiet_hours_end = excluded.quiet_hours_end,
           notification_channels = excluded.notification_channels, updated_at = now()`,
        [owner, int(fd, "quietStart"), int(fd, "quietEnd"), { in_app: true, email: bool(fd, "email"), push: bool(fd, "push"), sms: false }],
      ),
    );
    return { ok: true, message: "Notification preferences saved." };
  }, ["/settings"]);
}

/* ---------------------------------- import ---------------------------------- */

async function attachPhotos(q: Parameters<Parameters<typeof asOwner>[0]>[0], owner: string, listingId: string, files: File[], origin: "user_upload" | "screenshot") {
  const [{ n }] = (await q.query<{ n: number }>(`select count(*)::int as n from listing_images where listing_id = $1`, [listingId])) as [{ n: number }];
  let pos = Number(n);
  for (const f of files.slice(0, 12)) {
    if (!f.size) continue;
    const img = await storeImage(owner, f);
    const [dup] = await q.query(`select 1 from listing_images where listing_id = $1 and sha256 = $2`, [listingId, img.sha256]);
    if (dup) continue;
    await q.query(
      `insert into listing_images (owner_id, listing_id, storage_path, origin, mime_type, width, height, phash, sha256, position) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [owner, listingId, img.storagePath, origin, img.mimeType, img.width, img.height, img.phash, img.sha256, pos++],
    );
    await q.query(
      `update source_listings set fingerprint = jsonb_set(coalesce(fingerprint, '{}'::jsonb), '{imageHashes}', coalesce(fingerprint->'imageHashes', '[]'::jsonb) || to_jsonb($2::text)) where id = $1`,
      [listingId, img.phash],
    );
  }
}

function files(fd: FormData, k: string): File[] {
  return fd.getAll(k).filter((f): f is File => typeof f === "object" && f !== null && "size" in f && (f as File).size > 0);
}

export async function importListingAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");
    const input: ImportListingInput = {
      url: str(fd, "url"),
      title,
      description: str(fd, "description"),
      askingPriceCents: money(fd, "askingPrice", true)!,
      category: str(fd, "category"),
      condition: str(fd, "condition"),
      sellerName: str(fd, "sellerName"),
      locationText: str(fd, "locationText"),
      locationPrecision: (str(fd, "locationPrecision") as ImportListingInput["locationPrecision"]) ?? "approximate",
      importMethod: ((m) => (m === "manual" && str(fd, "url") ? "url" : m))((str(fd, "importMethod") as ImportListingInput["importMethod"]) ?? "manual"),
    };
    const res = await asOwner(async (q, owner) => {
      const r = await importListing(q, owner, input);
      const photos = files(fd, "photos");
      if (photos.length) {
        await attachPhotos(q, owner, r.listingId, photos, input.importMethod === "screenshot" ? "screenshot" : "user_upload");
      }
      const minutes = int(fd, "driveMinutes");
      const miles = decimal(fd, "driveMiles");
      if (minutes !== null && miles !== null) {
        await recordRoute(q, owner, r.opportunityId, { source: "manual", precision: input.locationPrecision === "exact" ? "exact" : "approximate", oneWayMinutes: minutes, oneWayMiles: miles, destinationText: input.locationText });
      } else if (bool(fd, "shipped")) {
        await recordRoute(q, owner, r.opportunityId, { source: "shipped", precision: "exact", oneWayMinutes: 0, oneWayMiles: 0 });
      }
      return r;
    });
    return {
      ok: true,
      message: res.duplicateOf ? "This listing was already tracked. Its price and observation were updated." : "Listing imported and evaluated.",
      redirectTo: `/deals/${res.opportunityId}${res.duplicateOf ? "?dup=1" : ""}`,
    };
  }, ["/radar", "/"]);
}

export async function extractScreenshotAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const f = files(fd, "screenshot")[0];
    if (!f) throw new Error("Choose a screenshot first");
    const sharp = (await import("sharp")).default;
    const buf = await sharp(Buffer.from(await f.arrayBuffer())).rotate().resize({ width: 1600, height: 3000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const crypto = await import("node:crypto");
    const out = await asOwner((q, owner) => screenshotToListing(q, owner, { base64: buf.toString("base64"), mediaType: "image/jpeg" }, crypto.createHash("sha256").update(buf).digest("hex")));
    if (!out.is_listing) return { ok: false, error: "That image does not look like a marketplace listing." };
    return { ok: true, message: "Fields extracted. Review them before importing.", data: out };
  });
}

/* ----------------------------------- deals ---------------------------------- */

export async function updateFactsAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "opportunityId") ?? "";
  return act(async () => {
    const pct = (k: string) => {
      const v = decimal(fd, k);
      return v === null ? undefined : Math.max(0, Math.min(1, v / 100));
    };
    await asOwner((q, owner) =>
      updateFacts(q, owner, uuid(fd, "opportunityId"), {
        title: str(fd, "title") ?? undefined,
        category: fd.has("category") ? str(fd, "category") : undefined,
        askingPriceCents: money(fd, "askingPrice") ?? undefined,
        identityStatus: (str(fd, "identityStatus") as never) ?? undefined,
        identityConfidence: pct("identityConfidence"),
        authenticityStatus: (str(fd, "authenticityStatus") as never) ?? undefined,
        conditionConfidence: pct("conditionConfidence"),
        functionalityTested: fd.has("functionalityTestedPresent") ? bool(fd, "functionalityTested") : undefined,
        rareItem: fd.has("rareItemPresent") ? bool(fd, "rareItem") : undefined,
        channel: (str(fd, "channel") as never) ?? undefined,
        shippingLabelCents: money(fd, "shippingLabel") ?? undefined,
        packagingCents: fd.has("packaging") ? money(fd, "packaging") : undefined,
        inboundShippingCents: money(fd, "inboundShipping") ?? undefined,
        repairEstimateCents: money(fd, "repairEstimate") ?? undefined,
        pickupMinutes: fd.has("pickupMinutes") ? int(fd, "pickupMinutes") : undefined,
        notes: fd.has("notes") ? str(fd, "notes") : undefined,
      }),
    );
    return { ok: true, message: "Saved and re-evaluated." };
  }, dealPaths(id));
}

export async function addCompAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "opportunityId") ?? "";
  return act(async () => {
    await asOwner((q, owner) =>
      addComparable(q, owner, uuid(fd, "opportunityId"), {
        productIdentity: str(fd, "productIdentity") ?? "",
        source: str(fd, "source") ?? "",
        sourceUrl: str(fd, "sourceUrl"),
        saleDate: str(fd, "saleDate"),
        priceCents: money(fd, "price", true)!,
        shippingCents: money(fd, "shipping"),
        condition: str(fd, "condition"),
        variant: str(fd, "variant"),
        grade: str(fd, "grade"),
        evidenceType: (str(fd, "evidenceType") as never) ?? "sold_user_recorded",
        matchConfidence: Math.max(0, Math.min(1, (decimal(fd, "matchConfidence") ?? 80) / 100)),
        variantMatch: str(fd, "variantMatch") !== "no",
        conditionMatch: (str(fd, "conditionMatch") as never) ?? "unknown",
        notes: str(fd, "notes"),
      }),
    );
    return { ok: true, message: "Comparable saved." };
  }, dealPaths(id));
}

export async function toggleCompAction(fd: FormData) {
  const id = uuid(fd, "opportunityId");
  await act(() => asOwner((q, owner) => setComparableExcluded(q, owner, uuid(fd, "compId"), bool(fd, "excluded"))), dealPaths(id));
}

export async function deleteCompAction(fd: FormData) {
  const id = uuid(fd, "opportunityId");
  await act(() => asOwner((q, owner) => deleteComparable(q, owner, uuid(fd, "compId"))), dealPaths(id));
}

export async function liquidityAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "opportunityId") ?? "";
  return act(async () => {
    const sold = int(fd, "soldCount90d");
    const active = int(fd, "activeCount");
    if (sold === null || active === null) throw new Error("Enter both the 90-day sold count and the active listing count.");
    await asOwner((q, owner) => recordLiquidity(q, owner, uuid(fd, "opportunityId"), { soldCount90d: sold, activeCount: active, source: str(fd, "source") ?? "Manual", sourceUrl: str(fd, "sourceUrl") }));
    return { ok: true, message: "Demand data saved." };
  }, dealPaths(id));
}

export async function activeCountAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const kw = str(fd, "keywords");
    if (!kw) throw new Error("Enter search keywords");
    const n = await asOwner((q, owner) => lookupActiveCount(q, owner, kw));
    return { ok: true, message: `${n.toLocaleString()} active eBay listings match "${kw}".`, data: n };
  });
}

export async function routeAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "opportunityId") ?? "";
  return act(async () => {
    const mode = str(fd, "mode");
    await asOwner(async (q, owner) => {
      const oppId = uuid(fd, "opportunityId");
      if (mode === "shipped") return recordRoute(q, owner, oppId, { source: "shipped", precision: "exact", oneWayMinutes: 0, oneWayMiles: 0 });
      if (mode === "google") {
        const dest = str(fd, "destination");
        if (!dest) throw new Error("Enter the pickup address or area");
        return computeRouteForOpportunity(q, owner, oppId, dest, (str(fd, "precision") as "exact" | "approximate") ?? "approximate");
      }
      return recordRoute(q, owner, oppId, {
        source: "manual",
        precision: (str(fd, "precision") as "exact" | "approximate") ?? "approximate",
        oneWayMinutes: int(fd, "oneWayMinutes"),
        oneWayMiles: decimal(fd, "oneWayMiles"),
        tollsCents: money(fd, "tolls") ?? 0,
        parkingCents: money(fd, "parking") ?? 0,
        destinationText: str(fd, "destination"),
      });
    });
    return { ok: true, message: "Travel updated and deal re-evaluated." };
  }, dealPaths(id));
}

export async function addRiskAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "opportunityId") ?? "";
  return act(async () => {
    await asOwner((q, owner) => addRiskFactor(q, owner, uuid(fd, "opportunityId"), str(fd, "code") ?? "", str(fd, "detail") ?? undefined));
  }, dealPaths(id));
}

export async function resolveRiskAction(fd: FormData) {
  const id = uuid(fd, "opportunityId");
  await act(() => asOwner((q, owner) => resolveRiskFactor(q, owner, id, str(fd, "code") ?? "", bool(fd, "resolved"))), dealPaths(id));
}

export async function decisionAction(fd: FormData) {
  const id = uuid(fd, "opportunityId");
  await act(() => asOwner((q, owner) => recordDecision(q, owner, id, (str(fd, "decision") as "pass" | "save" | "pursue") ?? "save", str(fd, "reason"))), dealPaths(id));
}

export async function reevaluateAction(fd: FormData) {
  const id = uuid(fd, "opportunityId");
  await act(() => asOwner((q, owner) => reevaluate(q, owner, id)), dealPaths(id));
}

export async function uploadPhotosAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "opportunityId") ?? "";
  return act(async () => {
    const photos = files(fd, "photos");
    if (!photos.length) throw new Error("Choose at least one photo");
    await asOwner(async (q, owner) => {
      const [o] = await q.query<{ listing_id: string | null }>(`select listing_id from opportunities where id = $1`, [uuid(fd, "opportunityId")]);
      if (!o?.listing_id) throw new Error("Listing not found");
      await attachPhotos(q, owner, o.listing_id, photos, "user_upload");
    });
    return { ok: true, message: `${photos.length} photo${photos.length === 1 ? "" : "s"} added.` };
  }, dealPaths(id));
}

export async function identifyAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "opportunityId") ?? "";
  return act(async () => {
    const out = await asOwner((q, owner) => identifyWithAi(q, owner, uuid(fd, "opportunityId")));
    return { ok: true, message: `AI found ${out.objects.length} object${out.objects.length === 1 ? "" : "s"}. Review the hypotheses below; nothing is verified until you confirm it.` };
  }, dealPaths(id));
}

export async function addCandidateAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "opportunityId") ?? "";
  return act(async () => {
    await asOwner((q, owner) =>
      addCandidate(q, owner, uuid(fd, "opportunityId"), {
        productName: str(fd, "productName") ?? "",
        brand: str(fd, "brand"),
        model: str(fd, "model"),
        variant: str(fd, "variant"),
        manufacturingPeriod: str(fd, "period"),
        identificationConfidence: Math.max(0, Math.min(1, (decimal(fd, "confidence") ?? 50) / 100)),
        rationale: str(fd, "rationale"),
      }),
    );
    return { ok: true, message: "Hypothesis added." };
  }, dealPaths(id));
}

export async function reviewCandidateAction(fd: FormData) {
  const id = uuid(fd, "opportunityId");
  await act(() => asOwner((q, owner) => reviewCandidate(q, owner, uuid(fd, "candidateId"), (str(fd, "decision") as "confirmed" | "rejected") ?? "rejected", str(fd, "notes"))), dealPaths(id));
}

export async function addEvidenceAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "opportunityId") ?? "";
  return act(async () => {
    const description = str(fd, "description");
    if (!description) throw new Error("Describe the evidence");
    await asOwner((q, owner) => addIdentityEvidence(q, owner, uuid(fd, "candidateId"), str(fd, "kind") ?? "marking", description, str(fd, "supports") !== "no", str(fd, "url")));
    return { ok: true, message: "Evidence recorded." };
  }, dealPaths(id));
}

/* -------------------------------- negotiation -------------------------------- */

export async function startNegotiationAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "opportunityId") ?? "";
  return act(async () => {
    await asOwner((q, owner) => startNegotiation(q, owner, uuid(fd, "opportunityId")));
    return { ok: true, redirectTo: `/negotiations/${id}` };
  }, dealPaths(id));
}

export async function updateDraftAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "opportunityId") ?? "";
  return act(async () => {
    await asOwner((q, owner) => updateDraft(q, owner, uuid(fd, "messageId"), str(fd, "body") ?? ""));
    return { ok: true, message: "Draft saved." };
  }, dealPaths(id));
}

export async function markSentAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "opportunityId") ?? "";
  return act(async () => {
    await asOwner(async (q, owner) => {
      const body = str(fd, "body");
      if (body) await updateDraft(q, owner, uuid(fd, "messageId"), body);
      await markMessageSent(q, owner, uuid(fd, "messageId"), money(fd, "offer"));
    });
    return { ok: true, message: "Recorded as sent. Resale Radar never sends messages on your behalf." };
  }, dealPaths(id));
}

export async function sellerReplyAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "opportunityId") ?? "";
  return act(async () => {
    const body = str(fd, "body");
    if (!body) throw new Error("Paste the seller's reply");
    const ev = await asOwner((q, owner) => recordSellerReply(q, owner, uuid(fd, "opportunityId"), body, money(fd, "counter")));
    return { ok: true, message: ev ? ev.explanation : "Reply recorded." };
  }, dealPaths(id));
}

export async function agreeAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "opportunityId") ?? "";
  return act(async () => {
    const when = str(fd, "pickupAt");
    await asOwner((q, owner) => markAgreed(q, owner, uuid(fd, "opportunityId"), money(fd, "price", true)!, when ? new Date(when).toISOString() : null, str(fd, "place")));
    return { ok: true, message: "Agreement recorded. Pickup added to your planner." };
  }, [...dealPaths(id), "/pickups"]);
}

export async function closeNegotiationAction(fd: FormData) {
  const id = uuid(fd, "opportunityId");
  await act(() => asOwner((q, owner) => closeNegotiation(q, owner, id, (str(fd, "outcome") as "declined" | "sold_elsewhere" | "abandoned") ?? "abandoned")), dealPaths(id));
}

/* --------------------------------- purchasing -------------------------------- */

export async function markPurchasedAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "opportunityId") ?? "";
  return act(async () => {
    const checklist: Record<string, boolean> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("check_")) checklist[k.slice(6)] = v === "on";
    for (const k of fd.getAll("checklistKeys")) if (typeof k === "string" && !(k in checklist)) checklist[k] = false;
    const itemId = await asOwner((q, owner) =>
      markPurchased(q, owner, uuid(fd, "opportunityId"), {
        pricePaidCents: money(fd, "pricePaid", true)!,
        purchaseTaxCents: money(fd, "purchaseTax") ?? 0,
        travelCostCents: money(fd, "travelCost") ?? 0,
        purchaseDate: str(fd, "purchaseDate") ?? new Date().toISOString().slice(0, 10),
        paymentMethod: str(fd, "paymentMethod"),
        serialNumber: str(fd, "serialNumber"),
        condition: str(fd, "condition"),
        accessories: str(fd, "accessories"),
        storageLocation: str(fd, "storageLocation"),
        inspectionChecklist: Object.keys(checklist).length ? checklist : undefined,
        inspectionNotes: str(fd, "inspectionNotes"),
        allowOverMax: bool(fd, "allowOverMax"),
      }),
    );
    return { ok: true, message: "Purchase recorded and added to inventory.", redirectTo: `/inventory/${itemId}` };
  }, [...dealPaths(id), "/inventory", "/financials", "/pickups"]);
}

/* --------------------------------- inventory --------------------------------- */

const invPaths = (id: string) => [`/inventory/${id}`, "/inventory", "/sales", "/financials", "/", "/analytics"];

export async function inventoryStatusAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "itemId") ?? "";
  return act(async () => {
    await asOwner((q, owner) =>
      updateInventoryStatus(q, owner, uuid(fd, "itemId"), (str(fd, "status") as InventoryStatus) ?? "acquired", {
        storageLocation: str(fd, "storageLocation"),
        testingStatus: str(fd, "testingStatus") ?? undefined,
        repairStatus: str(fd, "repairStatus") ?? undefined,
      }),
    );
    return { ok: true, message: "Updated." };
  }, invPaths(id));
}

export async function addCostAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "itemId") ?? "";
  return act(async () => {
    await asOwner((q, owner) => addInventoryCost(q, owner, uuid(fd, "itemId"), (str(fd, "kind") as never) ?? "other", money(fd, "amount", true)!, bool(fd, "capitalized"), str(fd, "note")));
    return { ok: true, message: "Cost recorded." };
  }, invPaths(id));
}

export async function saleListingAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "itemId") ?? "";
  return act(async () => {
    await asOwner((q, owner) =>
      upsertSaleListing(q, owner, uuid(fd, "itemId"), {
        channel: (str(fd, "channel") as never) ?? "ebay_us",
        title: str(fd, "title") ?? "",
        priceCents: money(fd, "price", true)!,
        minOfferCents: money(fd, "minOffer"),
        externalListingId: str(fd, "externalListingId"),
        status: (str(fd, "status") as "draft" | "active") ?? "draft",
        data: { itemSpecifics: str(fd, "itemSpecifics"), conditionDescription: str(fd, "conditionDescription") },
      }),
    );
    return { ok: true, message: str(fd, "status") === "active" ? "Listing marked active." : "Draft saved." };
  }, invPaths(id));
}

export async function recordSaleAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "itemId") ?? "";
  return act(async () => {
    const r = await asOwner((q, owner) =>
      recordSale(q, owner, uuid(fd, "itemId"), {
        channel: (str(fd, "channel") as never) ?? "ebay_us",
        externalOrderId: str(fd, "externalOrderId") ?? `manual-${Date.now()}`,
        soldDate: str(fd, "soldDate") ?? new Date().toISOString().slice(0, 10),
        itemPriceCents: money(fd, "itemPrice", true)!,
        shippingChargedCents: money(fd, "shippingCharged") ?? 0,
        taxCollectedCents: money(fd, "taxCollected") ?? 0,
        feesCents: money(fd, "fees"),
        labelCostCents: money(fd, "labelCost") ?? 0,
        suppliesCents: money(fd, "supplies") ?? 0,
        carrier: str(fd, "carrier"),
        tracking: str(fd, "tracking"),
      }),
    );
    return { ok: true, redirectTo: `/inventory/${id}?sold=1${r.feesEstimated ? "&feesEstimated=1" : ""}` };
  }, invPaths(id));
}

export async function shipAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "itemId") ?? "";
  return act(async () => {
    await asOwner((q, owner) => markShipped(q, owner, uuid(fd, "itemId"), str(fd, "carrier"), str(fd, "tracking")));
    return { ok: true, message: "Marked shipped." };
  }, invPaths(id));
}

export async function returnAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "itemId") ?? "";
  return act(async () => {
    await asOwner((q, owner) =>
      recordReturn(q, owner, uuid(fd, "itemId"), {
        refundCents: money(fd, "refund", true)!,
        feeCreditCents: money(fd, "feeCredit") ?? 0,
        returnShippingCents: money(fd, "returnShipping") ?? 0,
        restocked: bool(fd, "restocked"),
        reason: str(fd, "reason"),
      }),
    );
    return { ok: true, message: "Refund recorded in the ledger." };
  }, invPaths(id));
}

export async function writeOffAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "itemId") ?? "";
  return act(async () => {
    await asOwner((q, owner) => writeOff(q, owner, uuid(fd, "itemId"), str(fd, "reason") ?? "Written off"));
    return { ok: true, message: "Item written off." };
  }, invPaths(id));
}

/* ---------------------------------- finance ---------------------------------- */

export async function contributionAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    await asOwner((q, owner) => recordContribution(q, owner, money(fd, "amount", true)!, str(fd, "note")));
    return { ok: true, message: "Contribution recorded." };
  }, ["/financials", "/"]);
}

export async function withdrawalAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    await asOwner((q, owner) => recordWithdrawal(q, owner, money(fd, "amount", true)!, str(fd, "note")));
    return { ok: true, message: "Withdrawal recorded." };
  }, ["/financials", "/"]);
}

export async function expenseAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    await asOwner((q, owner) => recordExpense(q, owner, (str(fd, "account") as AccountCode) ?? "other_expense", money(fd, "amount", true)!, str(fd, "vendor"), str(fd, "note")));
    return { ok: true, message: "Expense recorded." };
  }, ["/financials", "/"]);
}

/* --------------------------------- watchlists -------------------------------- */

const list = (fd: FormData, k: string) => (str(fd, k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export async function saveWatchlistAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    await asOwner((q, owner) =>
      saveWatchlist(
        q,
        owner,
        {
          name: str(fd, "name") ?? "",
          active: bool(fd, "active"),
          sources: fd.getAll("sources").filter((s): s is string => typeof s === "string"),
          categories: fd.getAll("categories").filter((s): s is string => typeof s === "string"),
          keywords: list(fd, "keywords"),
          exclusions: list(fd, "exclusions"),
          minPriceCents: money(fd, "minPrice"),
          maxPriceCents: money(fd, "maxPrice"),
          maxTravelMinutes: int(fd, "maxTravelMinutes"),
          minRoiBps: decimal(fd, "minRoi") === null ? null : percentToBps(decimal(fd, "minRoi")!),
          minNetProfitCents: money(fd, "minNetProfit"),
          requiredEvidence: (str(fd, "requiredEvidence") as never) ?? "moderate",
          pollMinutes: int(fd, "pollMinutes") ?? 60,
        },
        str(fd, "id") ?? undefined,
      ),
    );
    return { ok: true, message: "Watchlist saved." };
  }, ["/watchlists"]);
}

export async function deleteWatchlistAction(fd: FormData) {
  await act(() => asOwner((q, owner) => deleteWatchlist(q, owner, uuid(fd, "id"))), ["/watchlists"]);
}

export async function runWatchlistAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const r = await asOwner((q, owner) => runWatchlist(q, owner, uuid(fd, "id")));
    if ("skipped" in r) return { ok: false, error: r.skipped === "ebay_not_configured" ? "eBay API credentials are not configured, so this search cannot run automatically yet." : "This watchlist is paused." };
    return { ok: true, message: `Found ${r.results} active listings, ${r.created} new. New listings were evaluated.` };
  }, ["/watchlists", "/radar"]);
}

/* ----------------------------------- trips ----------------------------------- */

export async function planTripAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return act(async () => {
    const ids = fd.getAll("opportunityIds").filter((s): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s));
    const legs: Record<string, { minutes: number; miles: number }> = {};
    for (const [k, v] of fd.entries()) {
      const m = k.match(/^leg_(min|mi)_(.+)$/);
      if (!m || typeof v !== "string" || v.trim() === "") continue;
      legs[m[2]!] ??= { minutes: 0, miles: 0 };
      if (m[1] === "min") legs[m[2]!]!.minutes = Math.round(Number(v));
      else legs[m[2]!]!.miles = Number(v);
    }
    const r = await asOwner((q, owner) => planPickupTrip(q, owner, ids, legs, str(fd, "name") ?? `Pickup run ${new Date().toLocaleDateString("en-US")}`));
    if (r.status === "needs_legs") return { ok: false, error: "Enter the drive time and miles between each pair of stops.", data: r };
    return { ok: true, message: "Trip planned." };
  }, ["/pickups"]);
}

/* ----------------------------------- alerts ---------------------------------- */

export async function markAlertsReadAction(fd: FormData) {
  const id = str(fd, "alertId");
  await act(() => asOwner((q) => (id ? q.query(`update alerts set read_at = now() where id = $1 and read_at is null`, [id]) : q.query(`update alerts set read_at = now() where read_at is null`))), ["/alerts", "/"]);
}

/* ---------------------------------- advisor ---------------------------------- */

export async function askAdvisorAction(question: string, history: { role: "user" | "assistant"; content: string }[]): Promise<ActionResult> {
  return act(async () => {
    const q0 = z.string().trim().min(2).max(2000).parse(question);
    const h = z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(20).parse(history);
    const r = await asOwner((q, owner) => askAdvisor(q, owner, q0, h));
    return { ok: true, data: r };
  });
}
