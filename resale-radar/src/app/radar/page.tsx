import { Car, ExternalLink, ImageOff, Radar, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { DecisionBadge, Money, Pct, relativeTime, ScoreRing, sourceLabel } from "@/components/domain";
import { Badge, Button, Card, EmptyState, Input, LinkButton, Notice, PageHeader, Select } from "@/components/ui";
import { DECISIONS, DECISION_LABELS, type Decision } from "@/domain/evaluate";
import { dollarsToCents, percentToBps } from "@/domain/money";
import { CATEGORY_LABELS } from "@/domain/settings";
import { asOwner } from "@/server/auth";
import { listFeed, STATUS_LABELS, type FeedFilters } from "@/server/services/opportunities";

export const metadata = { title: "Live Deal Radar" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function RadarPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const filters: FeedFilters = {
    decision: (one(sp.decision) as Decision | "ACTIONABLE") ?? null,
    status: (one(sp.status) as FeedFilters["status"]) ?? "OPEN",
    category: one(sp.category) ?? null,
    search: one(sp.search) ?? null,
    minNetCents: one(sp.minNet) ? dollarsToCents(one(sp.minNet)!) : null,
    minRoiBps: one(sp.minRoi) ? percentToBps(Number(one(sp.minRoi))) : null,
    maxMinutes: one(sp.maxMinutes) ? Number(one(sp.maxMinutes)) : null,
    sort: (one(sp.sort) as FeedFilters["sort"]) ?? "score",
  };
  if (one(sp.status) === "ALL") filters.status = null;
  const items = await asOwner((q, o) => listFeed(q, o, filters));

  const quick = [
    { label: "Actionable", href: "/radar?decision=ACTIONABLE" },
    { label: "Worth the Drive", href: "/radar?decision=WORTH_THE_DRIVE" },
    { label: "Hidden gems", href: "/radar?decision=HIDDEN_GEM" },
    { label: "Needs research", href: "/radar?decision=RESEARCH_REQUIRED" },
    { label: "Highest profit", href: "/radar?sort=profit" },
    { label: "Best ROI", href: "/radar?sort=roi" },
    { label: "Closest", href: "/radar?sort=drive" },
    { label: "Newest", href: "/radar?sort=recent" },
  ];

  return (
    <div className="animate-in">
      <PageHeader
        icon={<Radar />}
        title="Live Deal Radar"
        description="Every tracked listing, evaluated against verified sold data, demand, all costs, and your distance rules."
        actions={<LinkButton href="/import" variant="primary">Import listing</LinkButton>}
      />
      {one(sp.welcome) ? (
        <div className="mb-4">
          <Notice tone="accent" title="You're set up">
            No live marketplace feed is connected yet, so the radar fills from listings you import. Paste a Facebook Marketplace link or upload a screenshot to analyze your first deal.
          </Notice>
        </div>
      ) : null}

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {quick.map((qk) => (
          <Link key={qk.label} href={qk.href} className="whitespace-nowrap rounded-full border border-border px-3 py-1 text-xs text-fg-muted hover:border-border-strong hover:text-fg">
            {qk.label}
          </Link>
        ))}
      </div>

      <details className="mb-4 rounded-xl border border-border bg-surface" open={Object.keys(sp).some((k) => !["welcome", "sort"].includes(k))}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium">
          <SlidersHorizontal className="size-4 text-fg-muted" /> Filters
        </summary>
        <form className="grid gap-3 border-t border-border px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
          <Input name="search" placeholder="Search title" defaultValue={filters.search ?? ""} className="lg:col-span-2" />
          <Select name="decision" defaultValue={one(sp.decision) ?? ""} aria-label="Decision">
            <option value="">Any decision</option>
            <option value="ACTIONABLE">Actionable</option>
            {DECISIONS.map((d) => <option key={d} value={d}>{DECISION_LABELS[d]}</option>)}
          </Select>
          <Select name="status" defaultValue={one(sp.status) ?? "OPEN"} aria-label="Status">
            <option value="OPEN">Open deals</option>
            <option value="ALL">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select name="category" defaultValue={filters.category ?? ""} aria-label="Category">
            <option value="">Any category</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select name="sort" defaultValue={filters.sort} aria-label="Sort">
            <option value="score">Sort: score</option>
            <option value="profit">Sort: net profit</option>
            <option value="roi">Sort: ROI</option>
            <option value="drive">Sort: drive time</option>
            <option value="recent">Sort: newest</option>
          </Select>
          <Input name="minNet" inputMode="decimal" placeholder="Min net profit $" defaultValue={one(sp.minNet) ?? ""} />
          <Input name="minRoi" inputMode="decimal" placeholder="Min ROI %" defaultValue={one(sp.minRoi) ?? ""} />
          <Input name="maxMinutes" inputMode="numeric" placeholder="Max drive min" defaultValue={one(sp.maxMinutes) ?? ""} />
          <div className="flex gap-2 lg:col-span-3 lg:justify-end">
            <LinkButton href="/radar" variant="ghost">Reset</LinkButton>
            <Button type="submit" variant="primary">Apply</Button>
          </div>
        </form>
      </details>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Radar />}
            title="No deals match"
            description="Import a listing to get a full evaluation, or loosen the filters."
            action={<LinkButton href="/import" variant="primary">Import listing</LinkButton>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((o) => (
            <Card key={o.id} className="group flex flex-col overflow-hidden transition-colors hover:border-border-strong">
              <Link href={o.decision === "HIDDEN_GEM" ? `/gems/${o.id}` : `/deals/${o.id}`} className="flex flex-1 flex-col">
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-surface-2">
                  {o.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${o.thumb}`} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-fg-subtle"><ImageOff className="size-6" /></div>
                  )}
                  <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                    <DecisionBadge decision={o.decision} className="shadow-sm" />
                    {o.requires_manual_review ? <Badge tone="caution">Manual review</Badge> : null}
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="line-clamp-2 font-medium leading-snug">{o.title}</h3>
                      <p className="mt-0.5 text-xs text-fg-muted">
                        {sourceLabel(o.source)}
                        {o.location_text ? ` · ${o.location_text}` : ""} · {relativeTime(o.created_at)}
                      </p>
                    </div>
                    <ScoreRing score={o.score} />
                  </div>
                  <div className="mt-auto grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs">
                    <div>
                      <div className="text-fg-subtle">Asking</div>
                      <div className="font-medium"><Money cents={o.asking_price_cents} /></div>
                    </div>
                    <div>
                      <div className="text-fg-subtle">Net (cons.)</div>
                      <div className="font-medium"><Money cents={o.conservative_net_cents} colored /></div>
                    </div>
                    <div>
                      <div className="text-fg-subtle">ROI</div>
                      <div className="font-medium"><Pct bps={o.conservative_roi_bps} colored threshold={2500} /></div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-fg-muted">
                    <span className="inline-flex items-center gap-1"><Car className="size-3" />{o.one_way_minutes !== null ? `${o.one_way_minutes} min` : "Drive time unknown"}</span>
                    <span>{STATUS_LABELS[o.status]}</span>
                  </div>
                </div>
              </Link>
              {o.canonical_url ? (
                <a href={o.canonical_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1 border-t border-border py-2 text-xs text-fg-muted hover:text-fg">
                  Original listing <ExternalLink className="size-3" />
                </a>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
