import { ArrowLeft, MessageSquareReply, Send, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { agreeAction, closeNegotiationAction, markSentAction, sellerReplyAction, startNegotiationAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/client-widgets";
import { Money, relativeTime } from "@/components/domain";
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, KeyValue, LinkButton, MoneyInput, Notice, Textarea, cn } from "@/components/ui";
import { formatCents } from "@/domain/money";
import { asOwner } from "@/server/auth";
import { getNegotiation, netAtPrice } from "@/server/services/negotiation";
import { getOpportunityDetail } from "@/server/services/opportunities";
import { NEGOTIATION_LABELS } from "../labels";

export const metadata = { title: "Negotiation" };
export const dynamic = "force-dynamic";

export default async function NegotiationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await asOwner(async (q, o) => ({ d: await getOpportunityDetail(q, o, id), n: await getNegotiation(q, o, id) }));
  if (!data.d) notFound();
  const { d, n } = data;
  const ev = d.evaluation;
  const asking = d.opportunity.asking_price_cents;
  const at = (p: number | null) => (p === null ? null : netAtPrice(ev, asking, p));
  const draft = n?.messages.filter((m) => m.status === "draft").at(-1);
  const lastCounter = n?.counters.at(-1);
  const open = n && !["agreed", "declined", "sold_elsewhere", "abandoned"].includes(n.status);

  return (
    <div className="flex flex-col gap-5 animate-in">
      <Link href="/negotiations" className="inline-flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" /> Negotiations</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{d.opportunity.title}</h1>
          <p className="text-sm text-fg-muted">Asking <Money cents={asking} />{n ? <> · <Badge tone={NEGOTIATION_LABELS[n.status]?.tone}>{NEGOTIATION_LABELS[n.status]?.label}</Badge></> : null}</p>
        </div>
        <LinkButton href={`/deals/${id}`} variant="secondary">Deal analysis</LinkButton>
      </div>

      {!n ? (
        <Card>
          <CardBody className="flex flex-col items-start gap-3">
            <p className="text-sm text-fg-muted">No negotiation yet.</p>
            {ev?.offers ? (
              <ActionForm action={startNegotiationAction}><input type="hidden" name="opportunityId" value={id} /><SubmitButton variant="primary">Start negotiation</SubmitButton></ActionForm>
            ) : (
              <Notice tone="caution">A maximum price is required first. Record sold comps, demand, and drive time on the deal.</Notice>
            )}
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader title="Conversation" description="Paste the seller's replies here to keep a complete record." />
              <CardBody className="flex flex-col gap-3">
                {n.messages.filter((m) => m.status !== "draft").length === 0 ? <p className="text-sm text-fg-muted">Nothing sent yet.</p> : null}
                {n.messages.filter((m) => m.status !== "draft").map((m) => (
                  <div key={m.id} className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm", m.direction === "outbound" ? "self-end bg-accent-soft text-fg" : "self-start border border-border bg-surface-2")}>
                    <p className="whitespace-pre-line">{m.body}</p>
                    <p className="mt-1 text-[11px] text-fg-subtle">{m.direction === "outbound" ? "You" : "Seller"} · {relativeTime(m.sent_at ?? m.created_at)}</p>
                  </div>
                ))}
              </CardBody>
            </Card>

            {draft && open ? (
              <Card className="border-accent/30">
                <CardHeader icon={<Send />} title="Suggested message" description="Edit it, copy it into the marketplace app, send it yourself, then record it here." />
                <CardBody>
                  <ActionForm action={markSentAction}>
                    <input type="hidden" name="opportunityId" value={id} />
                    <input type="hidden" name="messageId" value={draft.id} />
                    <Textarea name="body" rows={4} defaultValue={draft.body} />
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label="Offer amount in this message (if any)" className="w-48"><MoneyInput name="offer" defaultValue={lastCounter?.suggested_counter_cents ?? (n.offers.length ? null : n.opening_offer_cents)} /></Field>
                      <CopyButton text={draft.body} label="Copy message" />
                      <SubmitButton variant="primary" size="sm">I sent it</SubmitButton>
                    </div>
                  </ActionForm>
                </CardBody>
              </Card>
            ) : null}

            {open ? (
              <Card>
                <CardHeader icon={<MessageSquareReply />} title="Record seller reply" description="Counteroffers are checked against your maximum and profit is recalculated." />
                <CardBody>
                  <ActionForm action={sellerReplyAction} resetOnSuccess>
                    <input type="hidden" name="opportunityId" value={id} />
                    <Textarea name="body" rows={3} required placeholder="Paste the seller's message" />
                    <Field label="Seller's counteroffer (if any)" className="w-56"><MoneyInput name="counter" /></Field>
                    <SubmitButton size="sm">Save reply</SubmitButton>
                  </ActionForm>
                </CardBody>
              </Card>
            ) : null}
          </div>

          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader icon={<ShieldCheck />} title="Price guardrails" />
              <CardBody>
                <KeyValue
                  items={[
                    { k: "Opening offer", v: <><Money cents={n.opening_offer_cents} /> <span className="text-xs text-fg-muted">net <Money cents={at(n.opening_offer_cents)} /></span></> },
                    { k: "Target", v: <><Money cents={n.target_price_cents} /> <span className="text-xs text-fg-muted">net <Money cents={at(n.target_price_cents)} /></span></> },
                    { k: "Maximum", v: <><Money cents={n.max_price_cents} /> <span className="text-xs text-fg-muted">net <Money cents={at(n.max_price_cents)} /></span></>, strong: true },
                    { k: "Asking", v: <><Money cents={asking} /> <span className="text-xs text-fg-muted">net <Money cents={at(asking)} /></span></> },
                  ]}
                />
                <p className="mt-2 text-xs text-fg-muted">Net figures are conservative-scenario profit after all costs.</p>
              </CardBody>
            </Card>
            {lastCounter ? (
              <Notice tone={lastCounter.decision === "walk_away" ? "negative" : lastCounter.decision === "accept" ? "positive" : "accent"} title={`Seller countered at ${formatCents(lastCounter.amount_cents)}`}>
                {lastCounter.decision === "accept" ? "Within your target. Accepting is reasonable." : lastCounter.decision === "counter" ? `Acceptable, but countering at ${formatCents(lastCounter.suggested_counter_cents)} is reasonable.` : "Above your maximum. Offer your max once, then walk away."}
                {lastCounter.conservative_net_cents !== null ? ` Net at that price: ${formatCents(lastCounter.conservative_net_cents)}.` : ""}
              </Notice>
            ) : null}
            {n.offers.length ? (
              <Card>
                <CardHeader title="Offers sent" />
                <ul className="divide-y divide-border text-sm">
                  {n.offers.map((o) => (
                    <li key={o.id} className="flex justify-between px-4 py-2 sm:px-5"><Money cents={o.amount_cents} /><span className="text-xs text-fg-muted">{relativeTime(o.created_at)}</span></li>
                  ))}
                </ul>
              </Card>
            ) : null}
            {open ? (
              <Card>
                <CardHeader title="Deal agreed?" description="Records the price and pickup. No money moves." />
                <CardBody className="flex flex-col gap-3">
                  <ActionForm action={agreeAction}>
                    <input type="hidden" name="opportunityId" value={id} />
                    <Field label="Agreed price"><MoneyInput name="price" required defaultValue={lastCounter && lastCounter.amount_cents <= (n.max_price_cents ?? 0) ? lastCounter.amount_cents : n.target_price_cents} /></Field>
                    <Field label="Pickup time"><Input type="datetime-local" name="pickupAt" /></Field>
                    <Field label="Meeting place" hint="Prefer a public place such as a police station exchange zone."><Input name="place" /></Field>
                    <SubmitButton variant="positive" size="sm">Record agreement</SubmitButton>
                  </ActionForm>
                  <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                    {(["declined", "sold_elsewhere", "abandoned"] as const).map((o) => (
                      <form key={o} action={closeNegotiationAction}>
                        <input type="hidden" name="opportunityId" value={id} />
                        <input type="hidden" name="outcome" value={o} />
                        <Button size="sm" variant="ghost" type="submit">{o === "declined" ? "Seller declined" : o === "sold_elsewhere" ? "Sold to someone else" : "Stop pursuing"}</Button>
                      </form>
                    ))}
                  </div>
                </CardBody>
              </Card>
            ) : n.status === "agreed" ? (
              <Card>
                <CardBody className="flex flex-col gap-2 text-sm">
                  <p>Agreed at <strong><Money cents={n.agreed_price_cents} /></strong>{n.proposed_pickup_at ? ` for ${new Date(n.proposed_pickup_at).toLocaleString("en-US")}` : ""}{n.pickup_place ? ` at ${n.pickup_place}` : ""}.</p>
                  <LinkButton href={`/deals/${id}#purchase`} variant="primary" size="sm">Inspect and record purchase</LinkButton>
                </CardBody>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
