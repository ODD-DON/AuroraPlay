import { Gem } from "lucide-react";
import Link from "next/link";
import { Money, relativeTime, sourceLabel } from "@/components/domain";
import { Badge, Card, CardHeader, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui";
import { asOwner } from "@/server/auth";
import { listFeed } from "@/server/services/opportunities";

export const metadata = { title: "Hidden Gems" };
export const dynamic = "force-dynamic";

export default async function GemsPage() {
  const { gems, research } = await asOwner(async (q, o) => ({
    gems: await listFeed(q, o, { decision: "HIDDEN_GEM", status: "OPEN", sort: "recent" }),
    research: await listFeed(q, o, { decision: "RESEARCH_REQUIRED", status: "OPEN", sort: "recent" }),
  }));
  return (
    <div className="flex flex-col gap-5 animate-in">
      <PageHeader icon={<Gem />} title="Hidden Gems" description="Potentially overlooked value that needs verification before any purchase decision." actions={<LinkButton href="/import" variant="primary">Import a lot or listing</LinkButton>} />
      <Notice tone="caution" title="Hypotheses, not valuations">
        A hidden gem flag means AI or you noticed signals of value (a generic title hiding a brand, a rare variant, a valuable item inside a cheap bundle). Resale Radar never recommends driving or buying on AI identification alone: confirm identity, authenticate where needed, and record sold comparables first.
      </Notice>
      <GemList title="Hidden gem candidates" items={gems} empty="No hidden gem candidates. Import listings with photos and run AI identification to surface them." />
      <GemList title="Research required" items={research} empty="Nothing waiting on research." />
    </div>
  );
}

function GemList({ title, items, empty }: { title: string; items: Awaited<ReturnType<typeof listFeed>>; empty: string }) {
  return (
    <Card>
      <CardHeader title={title} description={`${items.length} open`} />
      {items.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((g) => (
            <li key={g.id}>
              <Link href={`/gems/${g.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/50 sm:px-5">
                {g.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${g.thumb}`} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-surface-2 text-fg-subtle"><Gem className="size-4" /></div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{g.title}</div>
                  <div className="text-xs text-fg-muted">{sourceLabel(g.source)} · {relativeTime(g.created_at)} · identity {Math.round(g.identity_confidence * 100)}%</div>
                </div>
                <div className="text-right">
                  <Money cents={g.asking_price_cents} className="font-medium" />
                  {g.hidden_gem_potential_high_cents ? <div><Badge tone="caution">AI upside to <Money cents={g.hidden_gem_potential_high_cents} /></Badge></div> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
