import { ArrowLeft, BadgeDollarSign, PackageCheck, PenLine, Receipt, Tag, Undo2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addCostAction, inventoryStatusAction, recordSaleAction, returnAction, saleListingAction, shipAction, writeOffAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/client-widgets";
import { Money } from "@/components/domain";
import { Badge, Card, CardBody, CardHeader, Field, Input, KeyValue, LinkButton, MoneyInput, Notice, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { calculateSaleFees, FEE_SCHEDULES } from "@/domain/fees";
import { formatCents } from "@/domain/money";
import { CATEGORY_FEE_MAP, CATEGORY_LABELS } from "@/domain/settings";
import { asOwner } from "@/server/auth";
import { getSettings } from "@/server/services/core";
import { getInventoryItem, INVENTORY_STATUS_LABELS, INVENTORY_STATUSES } from "@/server/services/inventory";
import { getOpportunityDetail } from "@/server/services/opportunities";

export const metadata = { title: "Inventory item" };
export const dynamic = "force-dynamic";

export default async function InventoryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await asOwner(async (q, o) => {
    const inv = await getInventoryItem(q, o, id);
    if (!inv) return null;
    const opp = inv.item.opportunity_id ? await getOpportunityDetail(q, o, inv.item.opportunity_id) : null;
    return { ...inv, opp, settings: (await getSettings(q, o)).settings };
  });
  if (!data) notFound();
  const { item, costs, listings, orders, opp, settings } = data;
  const sold = ["sold", "fulfillment_pending", "shipped", "completed"].includes(item.status);
  const v = opp?.evaluation?.valuation;
  const label = opp?.opportunity.shipping_label_cents ?? 0;
  const feeCat = item.category ? CATEGORY_FEE_MAP[item.category] ?? null : null;
  const net = (price: number) =>
    price - calculateSaleFees(FEE_SCHEDULES.ebay_us!, { itemPriceCents: price, shippingChargedCents: 0, buyerSalesTaxBps: settings.buyerSalesTaxBps, categoryId: feeCat }, settings.sellerAdjustments).totalFeesCents - label - settings.defaultPackagingCents;
  const tiers = v?.status === "valued"
    ? [
        { name: "Fast sale", price: v.p25Cents ?? v.conservativeCents!, note: "Priced at the lower quartile of sold comps" },
        { name: "Market", price: v.medianCents!, note: "Median sold price" },
        { name: "Higher margin", price: v.p75Cents ?? v.optimisticCents!, note: "Upper quartile; expect a longer wait" },
      ]
    : [];
  const confirmed = opp?.candidates.find((c) => c.status === "confirmed");
  const suggestedTitle = [confirmed?.brand, confirmed?.product_name ?? item.name, confirmed?.model, confirmed?.variant, item.accessories ? "with accessories" : null, item.testing_status === "passed" ? "Tested" : null]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 80);
  const specifics = [
    confirmed?.brand ? `Brand: ${confirmed.brand}` : null,
    confirmed?.model ? `Model: ${confirmed.model}` : null,
    confirmed?.variant ? `Variant: ${confirmed.variant}` : null,
    item.serial_number ? "Serial: available on request" : null,
    item.condition ? `Condition: ${item.condition}` : null,
    item.accessories ? `Included: ${item.accessories}` : null,
  ].filter(Boolean).join("\n");
  const activeListing = listings.find((l) => l.status === "active" || l.status === "draft");

  return (
    <div className="flex flex-col gap-5 animate-in">
      <Link href="/inventory" className="inline-flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" /> Inventory</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1 flex gap-2"><Badge>{INVENTORY_STATUS_LABELS[item.status]}</Badge><Badge>{item.sku}</Badge>{item.category ? <Badge>{CATEGORY_LABELS[item.category]}</Badge> : null}</div>
          <h1 className="text-xl font-semibold tracking-tight">{item.name}</h1>
          <p className="text-sm text-fg-muted">Bought {item.purchase_date} for <Money cents={item.purchase_price_cents} /> · {item.age_days} days in inventory</p>
        </div>
        {item.opportunity_id ? <LinkButton href={`/deals/${item.opportunity_id}`} variant="secondary">Original research</LinkButton> : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-5">
          {!sold && item.status !== "written_off" ? (
            <Card>
              <CardHeader icon={<Tag />} title="Listing assistant" description="Accurate title and specifics, honest condition, and prices backed by sold comps." />
              <CardBody className="flex flex-col gap-4">
                {tiers.length ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    {tiers.map((t) => (
                      <div key={t.name} className="rounded-lg border border-border bg-bg-subtle p-3">
                        <div className="text-xs text-fg-muted">{t.name}</div>
                        <div className="text-lg font-semibold tabular">{formatCents(t.price)}</div>
                        <div className="text-xs">Net proceeds <span className="font-medium tabular">{formatCents(net(t.price))}</span></div>
                        <div className="text-xs">Profit <Money cents={net(t.price) - item.cost_basis_cents} colored /></div>
                        <p className="mt-1 text-[11px] text-fg-subtle">{t.note}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Notice tone="caution">No sold comparables on the original deal, so price tiers are unavailable. Research sold prices before listing.</Notice>
                )}
                <ActionForm action={saleListingAction}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <Field label="Title (80 characters max)">
                    <div className="flex gap-2"><Input name="title" maxLength={80} required defaultValue={activeListing?.title ?? suggestedTitle} /><CopyButton text={activeListing?.title ?? suggestedTitle} label="Copy" /></div>
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="List price"><MoneyInput name="price" required defaultValue={activeListing?.priceCents ?? v?.medianCents ?? undefined} /></Field>
                    <Field label="Minimum acceptable offer" hint="Your break-even plus minimum profit"><MoneyInput name="minOffer" defaultValue={activeListing?.minOfferCents ?? undefined} /></Field>
                    <Field label="Channel"><Select name="channel" defaultValue={activeListing?.channel ?? "ebay_us"}><option value="ebay_us">eBay</option><option value="local_cash">Local</option><option value="other">Other</option></Select></Field>
                  </div>
                  <Field label="Item specifics"><Textarea name="itemSpecifics" rows={4} defaultValue={(activeListing?.data?.itemSpecifics as string) ?? specifics} /></Field>
                  <Field label="Condition description" hint="Disclose every known defect. Never hide or invent details."><Textarea name="conditionDescription" rows={3} defaultValue={(activeListing?.data?.conditionDescription as string) ?? item.condition ?? ""} /></Field>
                  <Field label="Marketplace listing ID (after you post it)"><Input name="externalListingId" defaultValue={activeListing?.externalListingId ?? ""} /></Field>
                  <p className="text-xs text-fg-muted">Photo checklist: front, back, sides, labels and model plate, serial (partially masked), every accessory, every defect, powered-on screen if electronic.</p>
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton size="sm" name="status" value="draft">Save draft</SubmitButton>
                    <SubmitButton size="sm" variant="primary" name="status" value="active">Mark as listed</SubmitButton>
                  </div>
                </ActionForm>
                <p className="text-xs text-fg-subtle">Listings are posted by you on the marketplace. Direct eBay listing creation is planned for the Sell API integration. Prices are never lowered automatically.</p>
              </CardBody>
            </Card>
          ) : null}

          {!sold && item.status !== "written_off" ? (
            <Card>
              <CardHeader icon={<BadgeDollarSign />} title="Record sale" description="Posts revenue, fees, shipping, and cost of goods sold to the ledger. Each order can be recorded once." />
              <CardBody>
                <ActionForm action={recordSaleAction}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Channel"><Select name="channel" defaultValue="ebay_us"><option value="ebay_us">eBay</option><option value="local_cash">Local cash</option><option value="other">Other</option></Select></Field>
                    <Field label="Order number"><Input name="externalOrderId" required placeholder="e.g. 12-34567-89012" /></Field>
                    <Field label="Sold date"><Input name="soldDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
                    <Field label="Item price"><MoneyInput name="itemPrice" required defaultValue={activeListing?.priceCents} /></Field>
                    <Field label="Shipping charged to buyer"><MoneyInput name="shippingCharged" /></Field>
                    <Field label="Sales tax collected by eBay"><MoneyInput name="taxCollected" /></Field>
                    <Field label="Actual fees" hint="From the order. Leave blank to estimate."><MoneyInput name="fees" /></Field>
                    <Field label="Shipping label"><MoneyInput name="labelCost" defaultValue={label || undefined} /></Field>
                    <Field label="Packing supplies"><MoneyInput name="supplies" defaultValue={settings.defaultPackagingCents} /></Field>
                  </div>
                  <SubmitButton variant="positive" size="sm">Record sale</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}

          {orders.length ? (
            <Card>
              <CardHeader icon={<Receipt />} title="Sale" />
              <CardBody className="flex flex-col gap-4">
                {orders.map((o) => (
                  <KeyValue
                    key={o.id}
                    items={[
                      { k: "Order", v: `${o.externalOrderId} (${o.channel})` },
                      { k: "Status", v: o.status },
                      { k: "Item price", v: formatCents(o.itemSubtotalCents) },
                      { k: "Shipping charged", v: formatCents(o.shippingChargedCents) },
                      { k: "Fees", v: formatCents(o.feesCents) },
                      { k: "Label", v: formatCents(o.labelCostCents) },
                      { k: "Payout", v: formatCents(o.payoutCents) },
                      { k: "Realized profit", v: <Money cents={item.actual_profit_cents} colored />, strong: true },
                    ]}
                  />
                ))}
                {item.status === "fulfillment_pending" ? (
                  <ActionForm action={shipAction}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Input name="carrier" placeholder="Carrier" />
                      <Input name="tracking" placeholder="Tracking number" />
                      <SubmitButton size="sm" variant="primary"><PackageCheck /> Mark shipped</SubmitButton>
                    </div>
                  </ActionForm>
                ) : null}
                <details>
                  <summary className="cursor-pointer text-sm font-medium"><Undo2 className="mr-1 inline size-4" />Record refund or return</summary>
                  <ActionForm action={returnAction} className="mt-3">
                    <input type="hidden" name="itemId" value={item.id} />
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Refund to buyer"><MoneyInput name="refund" required /></Field>
                      <Field label="Fees credited back"><MoneyInput name="feeCredit" /></Field>
                      <Field label="Return shipping paid"><MoneyInput name="returnShipping" /></Field>
                    </div>
                    <Field label="Reason"><Input name="reason" /></Field>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="restocked" className="size-4 accent-[var(--accent)]" /> Item came back sellable (return to inventory)</label>
                    <SubmitButton size="sm" variant="danger">Record refund</SubmitButton>
                  </ActionForm>
                </details>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Cost basis" />
            <CardBody className="flex flex-col gap-3">
              <KeyValue items={[{ k: "Purchase price", v: formatCents(item.purchase_price_cents) }, { k: "Cost basis", v: formatCents(item.cost_basis_cents), strong: true }, { k: "Estimated resale", v: formatCents(item.estimated_resale_cents) }]} />
              <Table>
                <thead><tr><Th>Cost</Th><Th className="text-right">Amount</Th></tr></thead>
                <tbody>
                  {costs.map((c) => (
                    <tr key={c.id}><Td className="text-xs">{c.kind.replace("_", " ")}{c.capitalized ? "" : " (expensed)"}{c.note ? ` · ${c.note}` : ""}</Td><Td className="text-right"><Money cents={c.amountCents} /></Td></tr>
                  ))}
                </tbody>
              </Table>
              {!sold ? (
                <ActionForm action={addCostAction} resetOnSuccess className="gap-2">
                  <input type="hidden" name="itemId" value={item.id} />
                  <div className="grid grid-cols-2 gap-2">
                    <Select name="kind" aria-label="Cost type"><option value="repair">Repair</option><option value="parts">Parts</option><option value="testing">Testing</option><option value="cleaning">Cleaning</option><option value="other">Other</option></Select>
                    <MoneyInput name="amount" required />
                  </div>
                  <Input name="note" placeholder="Note" />
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="capitalized" defaultChecked className="size-4 accent-[var(--accent)]" /> Add to cost basis</label>
                  <SubmitButton size="sm">Add cost</SubmitButton>
                </ActionForm>
              ) : null}
            </CardBody>
          </Card>
          {!sold && item.status !== "written_off" ? (
            <Card>
              <CardHeader icon={<PenLine />} title="Status" />
              <CardBody className="flex flex-col gap-4">
                <ActionForm action={inventoryStatusAction}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <Field label="Status">
                    <Select name="status" defaultValue={item.status}>
                      {INVENTORY_STATUSES.filter((s) => !["sold", "written_off", "fulfillment_pending", "shipped", "completed"].includes(s)).map((s) => <option key={s} value={s}>{INVENTORY_STATUS_LABELS[s]}</option>)}
                    </Select>
                  </Field>
                  <Field label="Testing">
                    <Select name="testingStatus" defaultValue={item.testing_status}><option value="untested">Untested</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="not_applicable">Not applicable</option></Select>
                  </Field>
                  <Field label="Storage location"><Input name="storageLocation" defaultValue={item.storage_location ?? ""} /></Field>
                  <SubmitButton size="sm">Update</SubmitButton>
                </ActionForm>
                <details>
                  <summary className="cursor-pointer text-sm text-negative">Write off this item</summary>
                  <ActionForm action={writeOffAction} className="mt-2">
                    <input type="hidden" name="itemId" value={item.id} />
                    <Input name="reason" required placeholder="Reason (damaged, unsellable, lost)" />
                    <SubmitButton size="sm" variant="danger">Write off {formatCents(item.cost_basis_cents)}</SubmitButton>
                  </ActionForm>
                </details>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
