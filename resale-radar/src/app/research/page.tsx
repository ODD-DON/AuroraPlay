import { BookOpenCheck, Search, Telescope } from "lucide-react";
import Link from "next/link";
import { activeCountAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Money } from "@/components/domain";
import { Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { EVIDENCE_LABELS, SOLD_EVIDENCE, type EvidenceType } from "@/domain/valuation";
import { ebayConfigured } from "@/integrations/ebay";
import { asOwner } from "@/server/auth";
import { num } from "@/server/db";

export const metadata = { title: "Market Research" };
export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const { comps, stats } = await asOwner(async (q) => ({
    comps: await q.query<{ id: string; opportunity_id: string; title: string; product_identity: string; source: string; source_url: string | null; sale_date: Date | null; total_price_cents: number; evidence_type: EvidenceType; excluded: boolean; last_verified_at: Date }>(
      `select c.id, c.opportunity_id, o.title, c.product_identity, c.source, c.source_url, c.sale_date, c.total_price_cents, c.evidence_type, c.excluded, c.last_verified_at
         from comparable_sales c join opportunities o on o.id = c.opportunity_id order by c.created_at desc limit 200`,
    ),
    stats: (await q.query<Record<string, unknown>>(
      `select count(*) filter (where evidence_type in ('sold_verified','sold_user_recorded')) as sold, count(*) filter (where evidence_type not in ('sold_verified','sold_user_recorded')) as context,
              count(distinct opportunity_id) as deals from comparable_sales`,
    ))[0],
  }));
  return (
    <div className="flex flex-col gap-5 animate-in">
      <PageHeader icon={<Telescope />} title="Market Research" description="Sold-comparable evidence across every deal. Each comp keeps its source, date, and evidence type." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Recorded comparables" description={`${num(stats?.sold)} sold transactions and ${num(stats?.context)} context records across ${num(stats?.deals)} deals`} />
          {comps.length === 0 ? (
            <EmptyState icon={<Search />} title="No comparables yet" description="Open a deal and add sold comparables in its Market Research section." />
          ) : (
            <Table>
              <thead><tr><Th>Comparable</Th><Th>Deal</Th><Th>Evidence</Th><Th>Date</Th><Th className="text-right">Total</Th></tr></thead>
              <tbody>
                {comps.map((c) => (
                  <tr key={c.id} className={c.excluded ? "opacity-50" : ""}>
                    <Td className="max-w-[240px]">
                      <div className="truncate">{c.product_identity}</div>
                      <div className="text-xs text-fg-muted">{c.source_url ? <a className="text-accent" href={c.source_url} target="_blank" rel="noopener noreferrer">{c.source}</a> : c.source}</div>
                    </Td>
                    <Td className="max-w-[200px] truncate"><Link className="hover:underline" href={`/deals/${c.opportunity_id}`}>{c.title}</Link></Td>
                    <Td><Badge tone={SOLD_EVIDENCE.has(c.evidence_type) ? "positive" : "neutral"}>{EVIDENCE_LABELS[c.evidence_type]}</Badge></Td>
                    <Td className="whitespace-nowrap text-xs">{c.sale_date ? new Date(c.sale_date).toLocaleDateString("en-US", { timeZone: "UTC" }) : "No date"}</Td>
                    <Td className="text-right"><Money cents={Number(c.total_price_cents)} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader icon={<BookOpenCheck />} title="Sold-comp workflow" description="Automated eBay sold data is not available to new developers." />
            <CardBody className="flex flex-col gap-3 text-sm text-fg-muted">
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>In eBay Seller Hub, open Research (Terapeak) and search the exact model and variant.</li>
                <li>Filter to the last 90 days, matching condition, and sold listings only.</li>
                <li>Record 5 to 10 sales that truly match: price, buyer-paid shipping, date, and the listing link.</li>
                <li>Note the 90-day sold count and the current active listing count for demand.</li>
                <li>Exclude anything graded differently, incomplete, or in better condition.</li>
              </ol>
              <Notice tone="neutral">Active listings, price guides, and AI estimates can be recorded as context, but they never set resale value.</Notice>
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<Search />} title="Active competition lookup" description="Counts current eBay listings for the sold-to-active ratio." />
            <CardBody>
              {ebayConfigured() ? (
                <ActionForm action={activeCountAction}>
                  <Field label="Search keywords"><Input name="keywords" required placeholder="e.g. Pioneer DDJ-FLX6" /></Field>
                  <SubmitButton size="sm" pendingLabel="Counting">Count active listings</SubmitButton>
                </ActionForm>
              ) : (
                <p className="text-sm text-fg-muted">Add eBay API credentials to count active listings automatically. Until then, read the count from an eBay search.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
