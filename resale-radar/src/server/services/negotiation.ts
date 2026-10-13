import "server-only";
import type { Evaluation } from "@/domain/evaluate";
import { formatCents } from "@/domain/money";
import { draftCounterMessage, draftOpeningMessage, draftPickupMessage, evaluateCounteroffer, type OfferLadder } from "@/domain/negotiation";
import { num, numOrNull, type Queryable } from "@/server/db";
import { audit, createAlert } from "./core";
import { getOpportunityDetail, setStatus } from "./opportunities";

export interface NegotiationState {
  id: string;
  status: string;
  opening_offer_cents: number | null;
  target_price_cents: number | null;
  max_price_cents: number | null;
  agreed_price_cents: number | null;
  proposed_pickup_at: Date | null;
  pickup_place: string | null;
  agreed_details: string | null;
  messages: { id: string; direction: string; body: string; status: string; generated_by: string; created_at: Date; sent_at: Date | null }[];
  offers: { id: string; amount_cents: number; conservative_net_cents: number | null; status: string; created_at: Date }[];
  counters: { id: string; amount_cents: number; decision: string; suggested_counter_cents: number | null; conservative_net_cents: number | null; created_at: Date }[];
}

export async function getNegotiation(q: Queryable, ownerId: string, opportunityId: string): Promise<NegotiationState | null> {
  const [n] = await q.query<Record<string, unknown>>(`select * from negotiations where opportunity_id = $1 and owner_id = $2`, [opportunityId, ownerId]);
  if (!n) return null;
  const messages = await q.query<NegotiationState["messages"][number]>(
    `select id, direction, body, status, generated_by, created_at, sent_at from negotiation_messages where negotiation_id = $1 and status <> 'discarded' order by created_at`,
    [n.id],
  );
  const offers = (await q.query<Record<string, unknown>>(`select * from offers where negotiation_id = $1 order by created_at`, [n.id])).map((o) => ({
    id: String(o.id), amount_cents: num(o.amount_cents), conservative_net_cents: numOrNull(o.conservative_net_cents), status: String(o.status), created_at: o.created_at as Date,
  }));
  const counters = (await q.query<Record<string, unknown>>(`select * from counteroffers where negotiation_id = $1 order by created_at`, [n.id])).map((c) => ({
    id: String(c.id), amount_cents: num(c.amount_cents), decision: String(c.decision), suggested_counter_cents: numOrNull(c.suggested_counter_cents),
    conservative_net_cents: numOrNull(c.conservative_net_cents), created_at: c.created_at as Date,
  }));
  return {
    id: String(n.id),
    status: String(n.status),
    opening_offer_cents: numOrNull(n.opening_offer_cents),
    target_price_cents: numOrNull(n.target_price_cents),
    max_price_cents: numOrNull(n.max_price_cents),
    agreed_price_cents: numOrNull(n.agreed_price_cents),
    proposed_pickup_at: (n.proposed_pickup_at as Date) ?? null,
    pickup_place: (n.pickup_place as string) ?? null,
    agreed_details: (n.agreed_details as string) ?? null,
    messages,
    offers,
    counters,
  };
}

function shortName(title: string): string {
  return title.split(/[,(|-]/)[0]!.trim().split(/\s+/).slice(0, 4).join(" ") || "item";
}

export async function startNegotiation(q: Queryable, ownerId: string, opportunityId: string): Promise<string> {
  const d = await getOpportunityDetail(q, ownerId, opportunityId);
  if (!d) throw new Error("Opportunity not found");
  const ladder = d.evaluation?.offers;
  if (!ladder) throw new Error("No safe maximum price is established yet. Add sold comparables and drive time first.");
  const [n] = await q.query<{ id: string }>(
    `insert into negotiations (owner_id, opportunity_id, status, opening_offer_cents, target_price_cents, max_price_cents)
     values ($1,$2,'not_started',$3,$4,$5)
     on conflict (opportunity_id) do update set opening_offer_cents = excluded.opening_offer_cents, target_price_cents = excluded.target_price_cents,
       max_price_cents = excluded.max_price_cents, updated_at = now()
     returning id`,
    [ownerId, opportunityId, ladder.openingOfferCents, ladder.targetPriceCents, ladder.maxPriceCents],
  );
  const body = draftOpeningMessage({
    seed: opportunityId,
    itemShortName: shortName(d.opportunity.title),
    offerCents: ladder.openingOfferCents,
    canPickUpToday: (d.evaluation?.travel.oneWayMinutes ?? 99) <= 30,
    conditional: d.evaluation && ["game_consoles", "electronics", "computers", "dj_equipment", "audio_vintage", "cameras"].includes(d.opportunity.category ?? "")
      ? "As long as it powers on and works, I can pay cash."
      : undefined,
  });
  await q.query(`insert into negotiation_messages (owner_id, negotiation_id, direction, body, status, generated_by) values ($1,$2,'outbound',$3,'draft','template')`, [ownerId, n!.id, body]);
  await audit(q, ownerId, "negotiation.started", "opportunity", opportunityId, { ladder });
  return n!.id;
}

export async function updateDraft(q: Queryable, ownerId: string, messageId: string, body: string) {
  await q.query(`update negotiation_messages set body = $3 where id = $1 and owner_id = $2 and status = 'draft'`, [messageId, ownerId, body.slice(0, 2000)]);
}

/**
 * The owner sends the message themselves (copy and paste into the marketplace).
 * Recording it never transmits anything to a marketplace.
 */
export async function markMessageSent(q: Queryable, ownerId: string, messageId: string, offerCents: number | null) {
  const [m] = await q.query<{ negotiation_id: string }>(
    `update negotiation_messages set status = 'sent_manually', sent_at = now() where id = $1 and owner_id = $2 and status in ('draft','approved') returning negotiation_id`,
    [messageId, ownerId],
  );
  if (!m) throw new Error("Message not found or already sent");
  await q.query(`insert into communication_approvals (owner_id, message_id) values ($1,$2) on conflict do nothing`, [ownerId, messageId]);
  const [n] = await q.query<{ opportunity_id: string; max_price_cents: number | null }>(`select opportunity_id, max_price_cents from negotiations where id = $1`, [m.negotiation_id]);
  if (offerCents !== null) {
    if (n?.max_price_cents != null && offerCents > num(n.max_price_cents)) throw new Error(`Offer exceeds your maximum of ${formatCents(num(n.max_price_cents))}.`);
    const d = await getOpportunityDetail(q, ownerId, n!.opportunity_id);
    await q.query(`insert into offers (owner_id, negotiation_id, amount_cents, conservative_net_cents) values ($1,$2,$3,$4)`, [
      ownerId, m.negotiation_id, offerCents, netAtPrice(d?.evaluation ?? null, d?.opportunity.asking_price_cents ?? 0, offerCents),
    ]);
  }
  await q.query(`update negotiations set status = $2, updated_at = now() where id = $1`, [m.negotiation_id, offerCents !== null ? "offer_sent" : "contacted"]);
  await setStatus(q, ownerId, n!.opportunity_id, "negotiating", "Contacted seller");
}

/**
 * Conservative net profit if purchased at `priceCents`. Private-party purchases carry no purchase
 * tax, so profit moves one-for-one with price relative to the evaluated asking price.
 */
export function netAtPrice(ev: Evaluation | null, askingCents: number, priceCents: number): number | null {
  const c = ev?.scenariosAtAsking?.find((s) => s.name === "conservative")?.result;
  return c ? c.netProfitCents + askingCents - priceCents : null;
}

export async function recordSellerReply(q: Queryable, ownerId: string, opportunityId: string, body: string, counterCents: number | null) {
  const n = await getNegotiation(q, ownerId, opportunityId);
  if (!n) throw new Error("Start the negotiation first");
  await q.query(`insert into negotiation_messages (owner_id, negotiation_id, direction, body, status, generated_by) values ($1,$2,'inbound',$3,'received','seller')`, [
    ownerId, n.id, body.slice(0, 4000),
  ]);
  if (counterCents === null) return null;
  const d = await getOpportunityDetail(q, ownerId, opportunityId);
  const ladder: OfferLadder = {
    openingOfferCents: n.opening_offer_cents ?? 0,
    targetPriceCents: n.target_price_cents ?? 0,
    maxPriceCents: n.max_price_cents ?? 0,
    askingPriceCents: d?.opportunity.asking_price_cents ?? 0,
    worthPursuing: true,
    rationale: "",
  };
  const lastOffer = n.offers.length ? n.offers[n.offers.length - 1]!.amount_cents : null;
  const evaluation = evaluateCounteroffer(counterCents, ladder, lastOffer);
  await q.query(`insert into counteroffers (owner_id, negotiation_id, amount_cents, decision, suggested_counter_cents, conservative_net_cents) values ($1,$2,$3,$4,$5,$6)`, [
    ownerId, n.id, counterCents, evaluation.decision, evaluation.suggestedCounterCents, netAtPrice(d?.evaluation ?? null, d?.opportunity.asking_price_cents ?? 0, counterCents),
  ]);
  await q.query(`update negotiations set status = 'countered', updated_at = now() where id = $1`, [n.id]);
  if (evaluation.decision === "counter" && evaluation.suggestedCounterCents) {
    await q.query(`insert into negotiation_messages (owner_id, negotiation_id, direction, body, status, generated_by) values ($1,$2,'outbound',$3,'draft','template')`, [
      ownerId, n.id,
      draftCounterMessage({ seed: `${opportunityId}:${n.counters.length}`, itemShortName: shortName(d?.opportunity.title ?? ""), offerCents: evaluation.suggestedCounterCents, canPickUpToday: (d?.evaluation?.travel.oneWayMinutes ?? 99) <= 30 }),
    ]);
  }
  await createAlert(q, ownerId, {
    kind: "seller_counteroffer",
    priority: evaluation.decision === "accept" ? "critical" : "high",
    title: `Seller replied: ${d?.opportunity.title ?? "deal"}`,
    body: `${formatCents(counterCents)}. ${evaluation.explanation}`,
    link: `/negotiations/${opportunityId}`,
    opportunityId,
    dedupeKey: `counter:${n.id}:${counterCents}:${n.counters.length}`,
  });
  return evaluation;
}

export async function markAgreed(q: Queryable, ownerId: string, opportunityId: string, priceCents: number, pickupAt: string | null, place: string | null) {
  const n = await getNegotiation(q, ownerId, opportunityId);
  if (!n) throw new Error("Start the negotiation first");
  if (n.max_price_cents !== null && priceCents > n.max_price_cents) {
    throw new Error(`Agreed price ${formatCents(priceCents)} exceeds your maximum of ${formatCents(n.max_price_cents)}. Re-run the analysis if the facts changed.`);
  }
  await q.query(`update negotiations set status = 'agreed', agreed_price_cents = $2, proposed_pickup_at = $3, pickup_place = $4, updated_at = now() where id = $1`, [
    n.id, priceCents, pickupAt, place,
  ]);
  if (pickupAt) {
    await q.query(`insert into negotiation_messages (owner_id, negotiation_id, direction, body, status, generated_by) values ($1,$2,'outbound',$3,'draft','template')`, [
      ownerId, n.id, draftPickupMessage(opportunityId, new Date(pickupAt).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" }), place),
    ]);
    await createAlert(q, ownerId, {
      kind: "pickup_reminder",
      priority: "normal",
      title: "Pickup scheduled",
      body: `${formatCents(priceCents)} on ${new Date(pickupAt).toLocaleString("en-US")}${place ? ` at ${place}` : ""}. Bring exact cash and testing gear.`,
      link: `/pickups`,
      opportunityId,
      dedupeKey: `pickup:${n.id}:${pickupAt}`,
    });
  }
  await audit(q, ownerId, "negotiation.agreed", "opportunity", opportunityId, { priceCents, pickupAt });
}

export async function closeNegotiation(q: Queryable, ownerId: string, opportunityId: string, outcome: "declined" | "sold_elsewhere" | "abandoned") {
  await q.query(`update negotiations set status = $3, updated_at = now() where opportunity_id = $1 and owner_id = $2`, [opportunityId, ownerId, outcome]);
  await setStatus(q, ownerId, opportunityId, outcome === "sold_elsewhere" ? "sold_by_other" : "passed", `Negotiation ${outcome.replace("_", " ")}`);
}

export async function listNegotiations(q: Queryable, ownerId: string) {
  const rows = await q.query<Record<string, unknown>>(
    `select n.*, o.title, o.asking_price_cents, o.decision, o.max_purchase_cents,
        (select body from negotiation_messages m where m.negotiation_id = n.id order by created_at desc limit 1) as last_message
       from negotiations n join opportunities o on o.id = n.opportunity_id
      where n.owner_id = $1 order by n.updated_at desc`,
    [ownerId],
  );
  return rows.map((r) => ({
    opportunityId: String(r.opportunity_id),
    title: String(r.title),
    status: String(r.status),
    askingCents: num(r.asking_price_cents),
    maxCents: numOrNull(r.max_price_cents),
    agreedCents: numOrNull(r.agreed_price_cents),
    pickupAt: (r.proposed_pickup_at as Date) ?? null,
    pickupPlace: (r.pickup_place as string) ?? null,
    lastMessage: (r.last_message as string) ?? null,
    updatedAt: r.updated_at as Date,
  }));
}
