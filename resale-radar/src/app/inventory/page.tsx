import { Boxes } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/domain";
import { Badge, Card, CardBody, EmptyState, LinkButton, PageHeader, Stat, Table, Td, Th, cn } from "@/components/ui";
import { formatCents } from "@/domain/money";
import { CATEGORY_LABELS } from "@/domain/settings";
import { asOwner } from "@/server/auth";
import { INVENTORY_STATUS_LABELS, listInventory, type InventoryStatus } from "@/server/services/inventory";

export const metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

const BUCKETS = [
  { label: "0 to 7 days", min: 0, max: 7 },
  { label: "8 to 14", min: 8, max: 14 },
  { label: "15 to 30", min: 15, max: 30 },
  { label: "31 to 60", min: 31, max: 60 },
  { label: "61 to 90", min: 61, max: 90 },
  { label: "Over 90", min: 91, max: Infinity },
];
const UNSOLD = new Set<InventoryStatus>(["acquired", "needs_inspection", "needs_cleaning", "needs_repair", "ready_to_list", "listed", "returned"]);

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const items = await asOwner((q, o) => listInventory(q, o, status ?? null));
  const unsold = items.filter((i) => UNSOLD.has(i.status));
  const tiedUp = unsold.reduce((a, i) => a + i.cost_basis_cents, 0);
  return (
    <div className="flex flex-col gap-5 animate-in">
      <PageHeader icon={<Boxes />} title="Inventory" description="Every purchase keeps its research history. Aging shows where capital is tied up." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {BUCKETS.map((b) => {
          const inB = unsold.filter((i) => i.age_days >= b.min && i.age_days <= b.max);
          const cost = inB.reduce((a, i) => a + i.cost_basis_cents, 0);
          return (
            <Card key={b.label} className={cn(b.min > 30 && inB.length > 0 && "border-caution/40")}>
              <CardBody className="py-3">
                <Stat label={b.label} value={`${inB.length}`} sub={formatCents(cost)} tone={b.min > 60 && inB.length ? "caution" : undefined} />
              </CardBody>
            </Card>
          );
        })}
      </div>
      <p className="text-sm text-fg-muted">{formatCents(tiedUp)} of capital in {unsold.length} unsold item{unsold.length === 1 ? "" : "s"}.</p>
      <div className="flex flex-wrap gap-2">
        <LinkButton href="/inventory" size="sm" variant={!status ? "primary" : "secondary"}>All</LinkButton>
        {(["ready_to_list", "listed", "fulfillment_pending", "shipped", "completed", "returned"] as const).map((s) => (
          <LinkButton key={s} href={`/inventory?status=${s}`} size="sm" variant={status === s ? "primary" : "secondary"}>{INVENTORY_STATUS_LABELS[s]}</LinkButton>
        ))}
      </div>
      <Card>
        {items.length === 0 ? (
          <EmptyState icon={<Boxes />} title="No inventory" description="Items appear here when you mark a deal as purchased." />
        ) : (
          <Table>
            <thead><tr><Th>Item</Th><Th>Status</Th><Th className="text-right">Age</Th><Th className="text-right">Cost basis</Th><Th className="text-right">Est. resale</Th><Th className="text-right">Listed at</Th><Th className="text-right">Profit</Th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="hover:bg-surface-2/40">
                  <Td className="max-w-[280px]">
                    <Link href={`/inventory/${i.id}`} className="font-medium hover:underline">{i.name}</Link>
                    <div className="text-xs text-fg-muted">{i.sku}{i.category ? ` · ${CATEGORY_LABELS[i.category] ?? i.category}` : ""}{i.storage_location ? ` · ${i.storage_location}` : ""}</div>
                  </Td>
                  <Td><Badge tone={i.status === "fulfillment_pending" ? "negative" : i.status === "listed" ? "accent" : ["completed", "shipped", "sold"].includes(i.status) ? "positive" : "neutral"}>{INVENTORY_STATUS_LABELS[i.status]}</Badge></Td>
                  <Td className={cn("text-right tabular", UNSOLD.has(i.status) && i.age_days > 30 && "text-caution")}>{i.age_days}d</Td>
                  <Td className="text-right"><Money cents={i.cost_basis_cents} /></Td>
                  <Td className="text-right"><Money cents={i.estimated_resale_cents} /></Td>
                  <Td className="text-right"><Money cents={i.listing_price_cents} /></Td>
                  <Td className="text-right"><Money cents={i.actual_profit_cents} colored /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
