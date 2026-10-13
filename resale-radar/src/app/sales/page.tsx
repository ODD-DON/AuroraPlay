import { Store } from "lucide-react";
import Link from "next/link";
import { Money, relativeTime } from "@/components/domain";
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { asOwner } from "@/server/auth";
import { num, numOrNull } from "@/server/db";

export const metadata = { title: "Listings and Sales" };
export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const { listings, orders } = await asOwner(async (q) => ({
    listings: await q.query<Record<string, unknown>>(
      `select s.*, i.name, i.cost_basis_cents, (current_date - coalesce(s.listed_at::date, s.created_at::date)) as days_listed
         from sale_listings s join inventory_items i on i.id = s.inventory_item_id where s.status in ('draft','active') order by s.created_at desc`,
    ),
    orders: await q.query<Record<string, unknown>>(
      `select o.*, i.id as item_id, i.name, i.actual_profit_cents, s.tracking, s.shipped_at
         from orders o join order_items oi on oi.order_id = o.id join inventory_items i on i.id = oi.inventory_item_id left join shipments s on s.order_id = o.id
        order by o.ordered_at desc limit 100`,
    ),
  }));
  return (
    <div className="flex flex-col gap-5 animate-in">
      <PageHeader icon={<Store />} title="Listings and Sales" description="Active listings, drafts, and recorded orders." />
      <Notice tone="neutral">eBay order and fee import requires the eBay Sell API connection, which is not built yet. Record sales from the inventory item page; each order number can be recorded only once.</Notice>
      <Card>
        <CardHeader title="Listings" description={`${listings.length} draft or active`} />
        {listings.length === 0 ? (
          <EmptyState title="No listings" description="Create listings from an inventory item's listing assistant." />
        ) : (
          <Table>
            <thead><tr><Th>Item</Th><Th>Channel</Th><Th>Status</Th><Th className="text-right">Price</Th><Th className="text-right">Cost</Th><Th className="text-right">Days</Th></tr></thead>
            <tbody>
              {listings.map((l) => (
                <tr key={String(l.id)}>
                  <Td><Link href={`/inventory/${l.inventory_item_id}`} className="font-medium hover:underline">{String(l.title)}</Link></Td>
                  <Td className="text-xs">{String(l.channel)}</Td>
                  <Td><Badge tone={l.status === "active" ? "accent" : "neutral"}>{String(l.status)}</Badge></Td>
                  <Td className="text-right"><Money cents={num(l.price_cents)} /></Td>
                  <Td className="text-right"><Money cents={num(l.cost_basis_cents)} /></Td>
                  <Td className="text-right tabular">{num(l.days_listed)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title="Orders" />
        {orders.length === 0 ? (
          <EmptyState title="No sales recorded yet" />
        ) : (
          <Table>
            <thead><tr><Th>Item</Th><Th>Order</Th><Th>Status</Th><Th className="text-right">Gross</Th><Th className="text-right">Fees</Th><Th className="text-right">Profit</Th><Th>When</Th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={String(o.id)}>
                  <Td><Link href={`/inventory/${o.item_id}`} className="font-medium hover:underline">{String(o.name)}</Link></Td>
                  <Td className="text-xs">{String(o.external_order_id)}{(o.raw as { feesEstimated?: boolean } | null)?.feesEstimated ? <Badge tone="caution" className="ml-1">fees est.</Badge> : null}</Td>
                  <Td><Badge tone={String(o.status).includes("refund") ? "negative" : "positive"}>{String(o.status).replace("_", " ")}</Badge></Td>
                  <Td className="text-right"><Money cents={num(o.item_subtotal_cents) + num(o.shipping_charged_cents)} /></Td>
                  <Td className="text-right"><Money cents={num(o.fees_cents)} /></Td>
                  <Td className="text-right"><Money cents={numOrNull(o.actual_profit_cents)} colored /></Td>
                  <Td className="whitespace-nowrap text-xs text-fg-muted">{relativeTime(o.ordered_at as Date)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
