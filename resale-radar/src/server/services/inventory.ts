import "server-only";
import { z } from "zod";
import { calculateSaleFees, FEE_SCHEDULES } from "@/domain/fees";
import { capitalizeCost, expense, inventoryPurchase, ownerContribution, ownerWithdrawal, refundEntry, saleEntry, writeOffEntry, type AccountCode } from "@/domain/ledger";
import { applyBps, formatCents } from "@/domain/money";
import { CATEGORY_FEE_MAP } from "@/domain/settings";
import { num, numOrNull, type Queryable } from "@/server/db";
import { audit, createAlert, getBuyingPower, getSettings, postEntry } from "./core";
import { getOpportunityDetail, setStatus } from "./opportunities";

export const INVENTORY_STATUSES = [
  "acquired", "needs_inspection", "needs_cleaning", "needs_repair", "ready_to_list", "listed", "sold",
  "fulfillment_pending", "shipped", "completed", "returned", "written_off",
] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const INVENTORY_STATUS_LABELS: Record<InventoryStatus, string> = {
  acquired: "Acquired", needs_inspection: "Needs inspection", needs_cleaning: "Needs cleaning", needs_repair: "Needs repair",
  ready_to_list: "Ready to list", listed: "Listed", sold: "Sold", fulfillment_pending: "Fulfillment pending", shipped: "Shipped",
  completed: "Completed", returned: "Returned", written_off: "Written off",
};

export const purchaseSchema = z.object({
  pricePaidCents: z.number().int().min(0).max(100_000_000),
  purchaseTaxCents: z.number().int().min(0).max(10_000_000).default(0),
  travelCostCents: z.number().int().min(0).max(1_000_000).default(0),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: z.string().max(60).nullable().optional(),
  serialNumber: z.string().max(120).nullable().optional(),
  condition: z.string().max(200).nullable().optional(),
  accessories: z.string().max(500).nullable().optional(),
  storageLocation: z.string().max(120).nullable().optional(),
  inspectionChecklist: z.record(z.string(), z.boolean()).optional(),
  inspectionNotes: z.string().max(2000).nullable().optional(),
  allowOverMax: z.boolean().default(false),
});

function makeSku(date: string): string {
  return `RR-${date.replace(/-/g, "").slice(2)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/**
 * Converts a deal into inventory without losing its research history.
 * Purchase price and purchase tax become cost basis; travel is a transportation expense.
 */
export async function markPurchased(q: Queryable, ownerId: string, opportunityId: string, raw: z.input<typeof purchaseSchema>) {
  const p = purchaseSchema.parse(raw);
  const d = await getOpportunityDetail(q, ownerId, opportunityId);
  if (!d) throw new Error("Opportunity not found");
  if (["purchased", "listed", "sold"].includes(d.opportunity.status)) throw new Error("This deal is already purchased.");
  const max = d.opportunity.max_purchase_cents;
  if (max !== null && p.pricePaidCents > max && !p.allowOverMax) {
    throw new Error(`Price paid exceeds the calculated maximum of ${formatCents(max)}. Confirm the override to record it anyway.`);
  }
  const { settings } = await getSettings(q, ownerId);
  const bp = await getBuyingPower(q, ownerId, settings);
  const totalCash = p.pricePaidCents + p.purchaseTaxCents + p.travelCostCents;
  if (totalCash > bp.cashCents) throw new Error(`This purchase needs ${formatCents(totalCash)} but only ${formatCents(bp.cashCents)} cash is recorded.`);

  const capitalized = p.purchaseTaxCents;
  const [item] = await q.query<{ id: string }>(
    `insert into inventory_items (owner_id, opportunity_id, sku, name, category, acquisition_source, purchase_date, purchase_price_cents, cost_basis_cents,
       serial_number, condition, accessories, storage_location, estimated_resale_cents, status, testing_status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
    [
      ownerId, opportunityId, makeSku(p.purchaseDate), d.opportunity.title, d.opportunity.category, d.listing?.source ?? "manual", p.purchaseDate,
      p.pricePaidCents, p.pricePaidCents + capitalized, p.serialNumber ?? null, p.condition ?? null, p.accessories ?? null, p.storageLocation ?? null,
      d.evaluation?.valuation.baseCents ?? null, p.inspectionChecklist ? "ready_to_list" : "needs_inspection",
      p.inspectionChecklist ? (Object.values(p.inspectionChecklist).every(Boolean) ? "passed" : "failed") : "untested",
    ],
  );
  const itemId = item!.id;
  const at = new Date(`${p.purchaseDate}T12:00:00Z`).toISOString();
  const purchaseEntry = await postEntry(q, ownerId, inventoryPurchase(itemId, p.pricePaidCents, capitalized, at, `Purchased ${d.opportunity.title}`));
  await q.query(`insert into inventory_costs (owner_id, inventory_item_id, kind, amount_cents, capitalized, journal_entry_id, incurred_at) values ($1,$2,'purchase',$3,true,$4,$5)`, [
    ownerId, itemId, p.pricePaidCents, purchaseEntry.id, at,
  ]);
  if (capitalized) {
    await q.query(`insert into inventory_costs (owner_id, inventory_item_id, kind, amount_cents, capitalized, journal_entry_id, incurred_at) values ($1,$2,'purchase_tax',$3,true,$4,$5)`, [
      ownerId, itemId, capitalized, purchaseEntry.id, at,
    ]);
  }
  if (p.travelCostCents > 0) {
    const t = await postEntry(q, ownerId, expense("transportation", p.travelCostCents, at, `Pickup travel: ${d.opportunity.title}`, `travel:${itemId}`));
    await q.query(`insert into inventory_costs (owner_id, inventory_item_id, kind, amount_cents, capitalized, journal_entry_id, incurred_at) values ($1,$2,'travel',$3,false,$4,$5)`, [
      ownerId, itemId, p.travelCostCents, t.id, at,
    ]);
  }
  if (p.inspectionChecklist) {
    await q.query(`insert into item_inspections (owner_id, opportunity_id, inventory_item_id, checklist, passed, notes) values ($1,$2,$3,$4,$5,$6)`, [
      ownerId, opportunityId, itemId, p.inspectionChecklist, Object.values(p.inspectionChecklist).every(Boolean), p.inspectionNotes ?? null,
    ]);
  }
  await q.query(`update negotiations set status = 'agreed', agreed_price_cents = coalesce(agreed_price_cents, $2) where opportunity_id = $1 and status <> 'agreed'`, [
    opportunityId, Math.min(p.pricePaidCents, d.opportunity.max_purchase_cents ?? p.pricePaidCents),
  ]).catch(() => undefined);
  await q.query(`insert into user_decisions (owner_id, opportunity_id, decision, system_decision) values ($1,$2,'purchase',$3)`, [ownerId, opportunityId, d.opportunity.decision]);
  await setStatus(q, ownerId, opportunityId, "purchased", `Paid ${formatCents(p.pricePaidCents)}`);
  await audit(q, ownerId, "inventory.purchased", "inventory_item", itemId, { opportunityId, pricePaidCents: p.pricePaidCents, overMax: max !== null && p.pricePaidCents > max });
  return itemId;
}

export interface InventoryRow {
  id: string;
  opportunity_id: string | null;
  sku: string;
  name: string;
  category: string | null;
  purchase_date: string;
  purchase_price_cents: number;
  cost_basis_cents: number;
  serial_number: string | null;
  condition: string | null;
  accessories: string | null;
  storage_location: string | null;
  testing_status: string;
  repair_status: string;
  estimated_resale_cents: number | null;
  status: InventoryStatus;
  sold_at: Date | null;
  actual_proceeds_cents: number | null;
  actual_fees_cents: number | null;
  actual_profit_cents: number | null;
  age_days: number;
  listing_price_cents: number | null;
  listing_id: string | null;
}

function mapItem(r: Record<string, unknown>): InventoryRow {
  return {
    ...(r as unknown as InventoryRow),
    purchase_date: r.purchase_date instanceof Date ? r.purchase_date.toISOString().slice(0, 10) : String(r.purchase_date).slice(0, 10),
    purchase_price_cents: num(r.purchase_price_cents),
    cost_basis_cents: num(r.cost_basis_cents),
    estimated_resale_cents: numOrNull(r.estimated_resale_cents),
    actual_proceeds_cents: numOrNull(r.actual_proceeds_cents),
    actual_fees_cents: numOrNull(r.actual_fees_cents),
    actual_profit_cents: numOrNull(r.actual_profit_cents),
    age_days: num(r.age_days),
    listing_price_cents: numOrNull(r.listing_price_cents),
    listing_id: (r.listing_id as string) ?? null,
  };
}

export async function listInventory(q: Queryable, ownerId: string, status?: string | null): Promise<InventoryRow[]> {
  const rows = await q.query<Record<string, unknown>>(
    `select i.*, (current_date - i.purchase_date) as age_days,
        (select price_cents from sale_listings s where s.inventory_item_id = i.id and s.status = 'active' order by created_at desc limit 1) as listing_price_cents,
        (select id from sale_listings s where s.inventory_item_id = i.id and s.status in ('active','draft') order by created_at desc limit 1) as listing_id
       from inventory_items i where i.owner_id = $1 and ($2::text is null or i.status = $2) order by i.purchase_date desc, i.created_at desc`,
    [ownerId, status ?? null],
  );
  return rows.map(mapItem);
}

export async function getInventoryItem(q: Queryable, ownerId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await q.query<Record<string, unknown>>(`select i.*, (current_date - i.purchase_date) as age_days, null as listing_price_cents, null as listing_id from inventory_items i where id = $1 and owner_id = $2`, [id, ownerId]);
  if (!r) return null;
  const costs = await q.query<Record<string, unknown>>(`select * from inventory_costs where inventory_item_id = $1 order by incurred_at`, [id]);
  const listings = await q.query<Record<string, unknown>>(`select * from sale_listings where inventory_item_id = $1 order by created_at desc`, [id]);
  const orders = await q.query<Record<string, unknown>>(
    `select o.*, s.label_cost_cents, s.supplies_cents, s.tracking from orders o join order_items oi on oi.order_id = o.id left join shipments s on s.order_id = o.id where oi.inventory_item_id = $1 order by o.ordered_at desc`,
    [id],
  );
  return {
    item: mapItem(r),
    costs: costs.map((c) => ({ id: String(c.id), kind: String(c.kind), amountCents: num(c.amount_cents), capitalized: !!c.capitalized, note: (c.note as string) ?? null, incurredAt: c.incurred_at as Date })),
    listings: listings.map((l) => ({ id: String(l.id), channel: String(l.channel), title: String(l.title), priceCents: num(l.price_cents), minOfferCents: numOrNull(l.min_offer_cents), status: String(l.status), externalListingId: (l.external_listing_id as string) ?? null, data: l.data as Record<string, unknown>, listedAt: (l.listed_at as Date) ?? null })),
    orders: orders.map((o) => ({ id: String(o.id), channel: String(o.channel), externalOrderId: String(o.external_order_id), orderedAt: o.ordered_at as Date, status: String(o.status), itemSubtotalCents: num(o.item_subtotal_cents), shippingChargedCents: num(o.shipping_charged_cents), feesCents: num(o.fees_cents), payoutCents: numOrNull(o.payout_cents), labelCostCents: numOrNull(o.label_cost_cents), tracking: (o.tracking as string) ?? null })),
  };
}

export async function updateInventoryStatus(q: Queryable, ownerId: string, id: string, status: InventoryStatus, fields: { storageLocation?: string | null; testingStatus?: string; repairStatus?: string } = {}) {
  if (status === "sold" || status === "written_off") throw new Error("Use Record Sale or Write Off for this change.");
  await q.query(
    `update inventory_items set status = $3, storage_location = coalesce($4, storage_location), testing_status = coalesce($5, testing_status), repair_status = coalesce($6, repair_status), updated_at = now() where id = $1 and owner_id = $2`,
    [id, ownerId, status, fields.storageLocation ?? null, fields.testingStatus ?? null, fields.repairStatus ?? null],
  );
  await audit(q, ownerId, "inventory.status", "inventory_item", id, { status });
}

export async function addInventoryCost(q: Queryable, ownerId: string, id: string, kind: "repair" | "parts" | "testing" | "cleaning" | "other", amountCents: number, capitalized: boolean, note: string | null) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Amount must be positive");
  const at = new Date().toISOString();
  const entry = capitalized
    ? await postEntry(q, ownerId, capitalizeCost(id, amountCents, at, note ?? `${kind} cost`))
    : await postEntry(q, ownerId, expense(kind === "testing" || kind === "repair" ? "repairs" : "other_expense", amountCents, at, note ?? `${kind} cost`));
  await q.query(`insert into inventory_costs (owner_id, inventory_item_id, kind, amount_cents, capitalized, note, journal_entry_id) values ($1,$2,$3,$4,$5,$6,$7)`, [
    ownerId, id, kind, amountCents, capitalized, note, entry.id,
  ]);
  if (capitalized) await q.query(`update inventory_items set cost_basis_cents = cost_basis_cents + $3, updated_at = now() where id = $1 and owner_id = $2`, [id, ownerId, amountCents]);
}

/* --------------------------------- listings -------------------------------- */

export const saleListingSchema = z.object({
  channel: z.enum(["ebay_us", "local_cash", "other"]),
  title: z.string().trim().min(3).max(80),
  priceCents: z.number().int().min(1).max(100_000_000),
  minOfferCents: z.number().int().min(0).nullable().optional(),
  externalListingId: z.string().max(40).nullable().optional(),
  status: z.enum(["draft", "active"]),
  data: z.record(z.string(), z.unknown()).default({}),
});

export async function upsertSaleListing(q: Queryable, ownerId: string, itemId: string, raw: z.input<typeof saleListingSchema>) {
  const l = saleListingSchema.parse(raw);
  const [existing] = await q.query<{ id: string }>(`select id from sale_listings where inventory_item_id = $1 and owner_id = $2 and status in ('draft','active') order by created_at desc limit 1`, [itemId, ownerId]);
  if (existing) {
    await q.query(
      `update sale_listings set channel = $3, title = $4, price_cents = $5, min_offer_cents = $6, external_listing_id = $7, status = $8, data = $9,
         listed_at = case when $8 = 'active' and listed_at is null then now() else listed_at end where id = $1 and owner_id = $2`,
      [existing.id, ownerId, l.channel, l.title, l.priceCents, l.minOfferCents ?? null, l.externalListingId ?? null, l.status, l.data],
    );
  } else {
    await q.query(
      `insert into sale_listings (owner_id, inventory_item_id, channel, title, price_cents, min_offer_cents, external_listing_id, status, data, listed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9, case when $8 = 'active' then now() else null end)`,
      [ownerId, itemId, l.channel, l.title, l.priceCents, l.minOfferCents ?? null, l.externalListingId ?? null, l.status, l.data],
    );
  }
  if (l.status === "active") {
    await q.query(`update inventory_items set status = 'listed', updated_at = now() where id = $1 and owner_id = $2 and status not in ('sold','shipped','completed')`, [itemId, ownerId]);
    const [i] = await q.query<{ opportunity_id: string | null }>(`select opportunity_id from inventory_items where id = $1`, [itemId]);
    if (i?.opportunity_id) await setStatus(q, ownerId, i.opportunity_id, "listed", null);
  }
}

/* ----------------------------------- sales ---------------------------------- */

export const saleSchema = z.object({
  channel: z.enum(["ebay_us", "local_cash", "other"]),
  externalOrderId: z.string().trim().min(1).max(80),
  soldDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  itemPriceCents: z.number().int().min(0).max(100_000_000),
  shippingChargedCents: z.number().int().min(0).max(1_000_000).default(0),
  taxCollectedCents: z.number().int().min(0).max(10_000_000).default(0),
  /** Actual fees from the order. When omitted, fees are estimated from the fee schedule and flagged. */
  feesCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  labelCostCents: z.number().int().min(0).max(1_000_000).default(0),
  suppliesCents: z.number().int().min(0).max(100_000).default(0),
  carrier: z.string().max(40).nullable().optional(),
  tracking: z.string().max(60).nullable().optional(),
});

export async function recordSale(q: Queryable, ownerId: string, itemId: string, raw: z.input<typeof saleSchema>) {
  const s = saleSchema.parse(raw);
  const detail = await getInventoryItem(q, ownerId, itemId);
  if (!detail) throw new Error("Inventory item not found");
  const item = detail.item;
  if (["sold", "shipped", "completed", "written_off"].includes(item.status)) throw new Error("This item is already sold or written off.");

  const [dup] = await q.query<{ id: string }>(`select id from orders where owner_id = $1 and channel = $2 and external_order_id = $3`, [ownerId, s.channel, s.externalOrderId]);
  if (dup) throw new Error(`Order ${s.externalOrderId} is already recorded.`);

  let fees = s.feesCents ?? null;
  let feesEstimated = false;
  if (fees === null) {
    if (s.channel === "ebay_us") {
      const { settings } = await getSettings(q, ownerId);
      fees = calculateSaleFees(
        FEE_SCHEDULES.ebay_us!,
        {
          itemPriceCents: s.itemPriceCents,
          shippingChargedCents: s.shippingChargedCents,
          buyerSalesTaxBps: s.taxCollectedCents > 0 ? Math.round((s.taxCollectedCents * 10_000) / Math.max(1, s.itemPriceCents + s.shippingChargedCents)) : settings.buyerSalesTaxBps,
          categoryId: item.category ? CATEGORY_FEE_MAP[item.category] ?? null : null,
        },
        settings.sellerAdjustments,
      ).totalFeesCents;
      feesEstimated = true;
    } else fees = 0;
  }
  const at = new Date(`${s.soldDate}T12:00:00Z`).toISOString();
  const payout = s.itemPriceCents + s.shippingChargedCents - fees - (s.channel === "ebay_us" ? s.labelCostCents : 0);
  const [order] = await q.query<{ id: string }>(
    `insert into orders (owner_id, channel, external_order_id, ordered_at, status, item_subtotal_cents, shipping_charged_cents, tax_collected_cents, fees_cents, payout_cents, raw)
     values ($1,$2,$3,$4,'paid',$5,$6,$7,$8,$9,$10) returning id`,
    [ownerId, s.channel, s.externalOrderId, at, s.itemPriceCents, s.shippingChargedCents, s.taxCollectedCents, fees, payout, { feesEstimated }],
  );
  await q.query(`insert into order_items (owner_id, order_id, inventory_item_id, sale_listing_id, price_cents) values ($1,$2,$3,$4,$5)`, [
    ownerId, order!.id, itemId, detail.listings.find((l) => l.status === "active")?.id ?? null, s.itemPriceCents,
  ]);
  if (s.channel !== "local_cash") {
    await q.query(`insert into shipments (owner_id, order_id, carrier, tracking, label_cost_cents, supplies_cents) values ($1,$2,$3,$4,$5,$6)`, [
      ownerId, order!.id, s.carrier ?? null, s.tracking ?? null, s.labelCostCents, s.suppliesCents,
    ]);
  }
  await postEntry(
    q,
    ownerId,
    saleEntry({
      itemId,
      orderRef: `${s.channel}:${s.externalOrderId}`,
      itemPriceCents: s.itemPriceCents,
      shippingChargedCents: s.shippingChargedCents,
      marketplaceFeesCents: fees,
      shippingLabelCents: s.labelCostCents,
      suppliesCents: s.suppliesCents,
      costBasisCents: item.cost_basis_cents,
      occurredAt: at,
    }),
  );
  const proceeds = s.itemPriceCents + s.shippingChargedCents;
  const profit = proceeds - fees - s.labelCostCents - s.suppliesCents - item.cost_basis_cents;
  await q.query(
    `update inventory_items set status = $3, sold_at = $4, actual_proceeds_cents = $5, actual_fees_cents = $6, actual_profit_cents = $7, updated_at = now() where id = $1 and owner_id = $2`,
    [itemId, ownerId, s.channel === "local_cash" ? "completed" : "fulfillment_pending", at, proceeds, fees, profit],
  );
  await q.query(`update sale_listings set status = 'sold', ended_at = now() where inventory_item_id = $1 and status = 'active'`, [itemId]);
  if (item.opportunity_id) await setStatus(q, ownerId, item.opportunity_id, "sold", `Sold for ${formatCents(proceeds)}`);
  await createAlert(q, ownerId, {
    kind: "sold_item",
    priority: "normal",
    title: `Sold: ${item.name}`,
    body: `${formatCents(proceeds)} gross, ${formatCents(profit)} realized profit${feesEstimated ? " (fees estimated; update with actual fees)" : ""}.`,
    link: `/inventory/${itemId}`,
    dedupeKey: `sold:${order!.id}`,
  });
  if (s.channel !== "local_cash") {
    await createAlert(q, ownerId, { kind: "shipment_needed", priority: "high", title: `Ship: ${item.name}`, body: "Buyer has paid. Ship within your handling time.", link: `/inventory/${itemId}`, dedupeKey: `ship:${order!.id}` });
  }
  await audit(q, ownerId, "sale.recorded", "inventory_item", itemId, { orderId: order!.id, profit, feesEstimated });
  await checkMilestones(q, ownerId);
  return { orderId: order!.id, profitCents: profit, feesEstimated };
}

export async function markShipped(q: Queryable, ownerId: string, itemId: string, carrier: string | null, tracking: string | null) {
  await q.query(`update inventory_items set status = 'shipped', updated_at = now() where id = $1 and owner_id = $2 and status = 'fulfillment_pending'`, [itemId, ownerId]);
  await q.query(
    `update shipments set carrier = coalesce($3, carrier), tracking = coalesce($4, tracking), shipped_at = now()
      where order_id in (select order_id from order_items where inventory_item_id = $1) and owner_id = $2`,
    [itemId, ownerId, carrier, tracking],
  );
}

export const returnSchema = z.object({
  refundCents: z.number().int().min(0).max(100_000_000),
  feeCreditCents: z.number().int().min(0).max(10_000_000).default(0),
  returnShippingCents: z.number().int().min(0).max(1_000_000).default(0),
  restocked: z.boolean(),
  reason: z.string().max(500).nullable().optional(),
});

export async function recordReturn(q: Queryable, ownerId: string, itemId: string, raw: z.input<typeof returnSchema>) {
  const r = returnSchema.parse(raw);
  const detail = await getInventoryItem(q, ownerId, itemId);
  if (!detail) throw new Error("Item not found");
  const order = detail.orders[0];
  if (!order) throw new Error("No recorded sale for this item.");
  if (r.refundCents > order.itemSubtotalCents + order.shippingChargedCents) throw new Error("Refund exceeds the amount the buyer paid.");
  const [ret] = await q.query<{ id: string }>(
    `insert into returns (owner_id, order_id, inventory_item_id, refund_cents, fee_credit_cents, return_shipping_cents, restocked, reason) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [ownerId, order.id, itemId, r.refundCents, r.feeCreditCents, r.returnShippingCents, r.restocked, r.reason ?? null],
  );
  await postEntry(
    q,
    ownerId,
    refundEntry({
      itemId,
      refundRef: ret!.id,
      refundCents: r.refundCents,
      feeCreditCents: r.feeCreditCents,
      returnShippingCents: r.returnShippingCents,
      restockCostBasisCents: r.restocked ? detail.item.cost_basis_cents : 0,
      occurredAt: new Date().toISOString(),
    }),
  );
  const full = r.refundCents >= order.itemSubtotalCents + order.shippingChargedCents;
  await q.query(`update orders set status = $2 where id = $1`, [order.id, full ? "refunded" : "partially_refunded"]);
  const newProfit = (detail.item.actual_profit_cents ?? 0) - r.refundCents + r.feeCreditCents - r.returnShippingCents + (r.restocked ? detail.item.cost_basis_cents : 0);
  await q.query(`update inventory_items set status = $3, actual_profit_cents = $4, updated_at = now() where id = $1 and owner_id = $2`, [
    itemId, ownerId, r.restocked ? "returned" : detail.item.status, r.restocked ? null : newProfit,
  ]);
  await audit(q, ownerId, "sale.returned", "inventory_item", itemId, r as Record<string, unknown>);
}

export async function writeOff(q: Queryable, ownerId: string, itemId: string, reason: string) {
  const detail = await getInventoryItem(q, ownerId, itemId);
  if (!detail) throw new Error("Item not found");
  if (["sold", "shipped", "completed", "written_off", "fulfillment_pending"].includes(detail.item.status)) throw new Error("Only unsold inventory can be written off.");
  await postEntry(q, ownerId, writeOffEntry(itemId, detail.item.cost_basis_cents, new Date().toISOString(), `Write-off: ${reason}`));
  await q.query(`update inventory_items set status = 'written_off', actual_profit_cents = $3, updated_at = now() where id = $1 and owner_id = $2`, [itemId, ownerId, -detail.item.cost_basis_cents]);
  await audit(q, ownerId, "inventory.written_off", "inventory_item", itemId, { reason });
}

/* --------------------------------- finance --------------------------------- */

export async function recordContribution(q: Queryable, ownerId: string, amountCents: number, note: string | null) {
  const e = await postEntry(q, ownerId, ownerContribution(amountCents, new Date().toISOString(), note ?? "Owner contribution"));
  await q.query(`insert into capital_contributions (owner_id, amount_cents, note, journal_entry_id) values ($1,$2,$3,$4)`, [ownerId, amountCents, note, e.id]);
}

export async function recordWithdrawal(q: Queryable, ownerId: string, amountCents: number, note: string | null) {
  const { settings } = await getSettings(q, ownerId);
  const bp = await getBuyingPower(q, ownerId, settings);
  if (amountCents > bp.cashCents) throw new Error("Withdrawal exceeds recorded cash.");
  const e = await postEntry(q, ownerId, ownerWithdrawal(amountCents, new Date().toISOString(), note ?? "Owner withdrawal"));
  await q.query(`insert into owner_withdrawals (owner_id, amount_cents, note, journal_entry_id) values ($1,$2,$3,$4)`, [ownerId, amountCents, note, e.id]);
}

export const EXPENSE_ACCOUNTS: AccountCode[] = ["supplies", "transportation", "software", "shipping_expense", "repairs", "other_expense"];

export async function recordExpense(q: Queryable, ownerId: string, account: AccountCode, amountCents: number, vendor: string | null, note: string | null) {
  if (!EXPENSE_ACCOUNTS.includes(account)) throw new Error("Invalid expense category");
  const e = await postEntry(q, ownerId, expense(account, amountCents, new Date().toISOString(), note ?? vendor ?? "Expense"));
  await q.query(`insert into expenses (owner_id, account_code, amount_cents, vendor, note, journal_entry_id) values ($1,$2,$3,$4,$5,$6)`, [ownerId, account, amountCents, vendor, note, e.id]);
}

export async function listJournal(q: Queryable, ownerId: string, limit = 500) {
  const rows = await q.query<Record<string, unknown>>(
    `select e.id, e.kind, e.memo, e.occurred_at, e.external_ref, l.account_code, l.debit_cents, l.credit_cents, l.inventory_item_id
       from financial_entries e join financial_entry_lines l on l.entry_id = e.id
      where e.owner_id = $1 order by e.occurred_at desc, e.created_at desc limit $2`,
    [ownerId, limit],
  );
  return rows.map((r) => ({
    entryId: String(r.id), kind: String(r.kind), memo: String(r.memo), occurredAt: r.occurred_at as Date, externalRef: (r.external_ref as string) ?? null,
    account: String(r.account_code), debitCents: num(r.debit_cents), creditCents: num(r.credit_cents), inventoryItemId: (r.inventory_item_id as string) ?? null,
  }));
}

export async function checkMilestones(q: Queryable, ownerId: string) {
  const { settings } = await getSettings(q, ownerId);
  const bp = await getBuyingPower(q, ownerId, settings);
  for (const m of [250_000, 500_000, 1_000_000, 2_000_000, 3_000_000]) {
    if (bp.summary.equityCents >= m) {
      await createAlert(q, ownerId, {
        kind: "profit_milestone",
        priority: "normal",
        title: `Milestone reached: ${formatCents(m, { compact: true })} business equity`,
        body: `Equity at cost is ${formatCents(bp.summary.equityCents)}.`,
        link: "/financials",
        dedupeKey: `milestone:${m}`,
      });
    }
  }
}

/** Aging alerts for capital tied up in unsold inventory. Run daily by the worker. */
export async function checkInventoryAging(q: Queryable, ownerId: string) {
  const items = await listInventory(q, ownerId);
  for (const i of items) {
    if (!["acquired", "needs_inspection", "needs_cleaning", "needs_repair", "ready_to_list", "listed", "returned"].includes(i.status)) continue;
    for (const days of [30, 60, 90]) {
      if (i.age_days >= days) {
        const markdown = i.listing_price_cents ? applyBps(i.listing_price_cents, 9_000) : null;
        await createAlert(q, ownerId, {
          kind: "inventory_aging",
          priority: days >= 60 ? "high" : "normal",
          title: `${i.name} has been in inventory ${days}+ days`,
          body: `${formatCents(i.cost_basis_cents)} of capital tied up.${markdown ? ` Consider a markdown to ${formatCents(markdown)} if margin allows (never applied automatically).` : ""}`,
          link: `/inventory/${i.id}`,
          dedupeKey: `aging:${i.id}:${days}`,
        });
      }
    }
  }
}
