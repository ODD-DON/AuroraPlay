import { ArrowRight, Bell, Boxes, Car, CircleAlert, Gem, Radar, Target, Wallet } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DecisionBadge, Money, Pct, relativeTime, ScoreRing } from "@/components/domain";
import { Badge, Card, CardBody, CardHeader, EmptyState, LinkButton, Notice, PageHeader, Progress, Stat } from "@/components/ui";
import { GROWTH_MILESTONES_CENTS } from "@/domain/ledger";
import { formatCents } from "@/domain/money";
import { aiConfigured } from "@/integrations/ai";
import { ebayConfigured } from "@/integrations/ebay";
import { routingConfigured } from "@/integrations/routing";
import { asOwner } from "@/server/auth";
import { num } from "@/server/db";
import { getBuyingPower, getSettings } from "@/server/services/core";
import { listInventory } from "@/server/services/inventory";
import { listFeed } from "@/server/services/opportunities";

export const dynamic = "force-dynamic";

export default async function CommandCenter() {
  const data = await asOwner(async (q, owner) => {
    const s = await getSettings(q, owner);
    if (!s.onboardingCompleted) return null;
    const bp = await getBuyingPower(q, owner, s.settings);
    const actionable = await listFeed(q, owner, { decision: "ACTIONABLE", status: "OPEN", sort: "score", limit: 6 });
    const gems = await listFeed(q, owner, { decision: "HIDDEN_GEM", status: "OPEN", limit: 3 });
    const alerts = await q.query<{ id: string; title: string; body: string; priority: string; link: string | null; created_at: Date; read_at: Date | null }>(
      `select id, title, body, priority, link, created_at, read_at from alerts order by created_at desc limit 6`,
    );
    const inventory = await listInventory(q, owner);
    const [counts] = await q.query<{ open: unknown; negotiating: unknown; research: unknown }>(
      `select count(*) filter (where status not in ('passed','expired','sold_by_other','unavailable','duplicate','sold')) as open,
              count(*) filter (where status = 'negotiating') as negotiating,
              count(*) filter (where decision in ('RESEARCH_REQUIRED','HIDDEN_GEM') and status not in ('passed','expired','sold_by_other','unavailable')) as research
         from opportunities`,
    );
    const watch = await q.query<{ n: unknown }>(`select count(*) as n from search_profiles where active and 'ebay' = any(sources)`);
    return { settings: s.settings, bp, actionable, gems, alerts, inventory, counts, activeWatchlists: num(watch[0]?.n) };
  });
  if (!data) redirect("/onboarding");

  const { bp, settings } = data;
  const equity = bp.summary.equityCents;
  const nextMilestone = GROWTH_MILESTONES_CENTS.find((m) => m > equity) ?? 3_000_000;
  const prevMilestone = [...GROWTH_MILESTONES_CENTS].reverse().find((m) => m <= equity) ?? 0;
  const unsold = data.inventory.filter((i) => !["sold", "shipped", "completed", "written_off", "fulfillment_pending"].includes(i.status));
  const aging = unsold.filter((i) => i.age_days > 30);
  const toShip = data.inventory.filter((i) => i.status === "fulfillment_pending");
  const monitoringActive = ebayConfigured() && data.activeWatchlists > 0;

  return (
    <div className="flex flex-col gap-5 animate-in">
      <PageHeader
        title="Command Center"
        description={`Sourcing from ${settings.homeLabel}. Normal area ${settings.travel.localAreaMinutes} min, exceptional deals up to ${settings.travel.maxTravelMinutes} min.`}
        actions={
          <>
            <LinkButton href="/analyzer" variant="secondary">Quick analysis</LinkButton>
            <LinkButton href="/import" variant="primary">Import listing</LinkButton>
          </>
        }
      />

      {!monitoringActive ? (
        <Notice tone="caution" icon={<CircleAlert />} title="Automated monitoring is not active">
          Facebook Marketplace has no authorized API, so Marketplace deals come in through{" "}
          <Link className="underline" href="/import">import</Link> (paste a link, share from the app, or upload a screenshot).{" "}
          {ebayConfigured() ? "Create an eBay watchlist to start automatic eBay monitoring." : "Add eBay API credentials to monitor eBay automatically."}{" "}
          <Link className="underline" href="/settings/integrations">See integration status</Link>.
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardBody><Stat icon={<Wallet />} label="Available buying power" value={formatCents(bp.availableCents)} sub={`${formatCents(bp.reserveCents)} reserve held`} /></CardBody></Card>
        <Card><CardBody><Stat icon={<Boxes />} label="Inventory at cost" value={formatCents(bp.summary.inventoryCostCents)} sub={`${unsold.length} unsold item${unsold.length === 1 ? "" : "s"}`} /></CardBody></Card>
        <Card>
          <CardBody>
            <Stat label="Realized operating profit" value={<Money cents={bp.summary.netOperatingProfitCents} colored />} sub="Sold items only. Unrealized value is not counted." tone={bp.summary.netOperatingProfitCents >= 0 ? undefined : "negative"} />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex flex-col gap-2">
            <Stat icon={<Target />} label="Business equity (at cost)" value={formatCents(equity)} sub={`Next milestone ${formatCents(nextMilestone, { compact: true })}`} />
            <Progress value={((equity - prevMilestone) / Math.max(1, nextMilestone - prevMilestone)) * 100} tone="positive" />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader
            icon={<Radar />}
            title="Best opportunities right now"
            description="Verified deals that clear your profit, ROI, demand, and distance rules."
            action={<LinkButton href="/radar" variant="ghost" size="sm">All deals <ArrowRight /></LinkButton>}
          />
          {data.actionable.length === 0 ? (
            <EmptyState
              icon={<Radar />}
              title="No qualifying opportunities"
              description="Nothing currently meets your evidence and profit requirements. That is a valid result: a system that recommends zero purchases beats one that loses money."
              action={<LinkButton href="/import" variant="primary">Import a listing</LinkButton>}
            />
          ) : (
            <ul className="divide-y divide-border">
              {data.actionable.map((o) => (
                <li key={o.id}>
                  <Link href={`/deals/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/50 sm:px-5">
                    <ScoreRing score={o.score} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{o.title}</span>
                        <DecisionBadge decision={o.decision} />
                        {o.requires_manual_review ? <Badge tone="caution">Manual review</Badge> : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-fg-muted">
                        <span>Asking <Money cents={o.asking_price_cents} /></span>
                        {o.max_purchase_cents !== null ? <span>Max <Money cents={o.max_purchase_cents} /></span> : null}
                        {o.one_way_minutes !== null ? <span className="inline-flex items-center gap-1"><Car className="size-3" />{o.one_way_minutes} min</span> : null}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold"><Money cents={o.conservative_net_cents} colored /></div>
                      <div className="text-xs text-fg-muted"><Pct bps={o.conservative_roi_bps} /> ROI</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader icon={<Bell />} title="Recent alerts" action={<LinkButton href="/alerts" variant="ghost" size="sm">All</LinkButton>} />
            {data.alerts.length === 0 ? (
              <EmptyState title="No alerts yet" description="Alerts appear when a deal qualifies, a seller replies, or inventory needs attention." />
            ) : (
              <ul className="divide-y divide-border">
                {data.alerts.map((a) => (
                  <li key={a.id}>
                    <Link href={a.link ?? "/alerts"} className="block px-4 py-2.5 hover:bg-surface-2/50 sm:px-5">
                      <div className="flex items-center gap-2">
                        {!a.read_at ? <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="Unread" /> : null}
                        <span className="truncate text-sm font-medium">{a.title}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{a.body}</p>
                      <p className="mt-0.5 text-[11px] text-fg-subtle">{relativeTime(a.created_at)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Needs attention" />
            <CardBody className="flex flex-col gap-2 text-sm">
              <AttentionRow href="/negotiations" label="Active negotiations" count={num(data.counts?.negotiating)} />
              <AttentionRow href="/gems" label="Deals needing research" count={num(data.counts?.research)} />
              <AttentionRow href="/inventory?status=fulfillment_pending" label="Orders to ship" count={toShip.length} urgent />
              <AttentionRow href="/inventory" label="Inventory over 30 days" count={aging.length} />
            </CardBody>
          </Card>
          {data.gems.length ? (
            <Card>
              <CardHeader icon={<Gem />} title="Hidden gem leads" description="Unverified. Research before buying." />
              <ul className="divide-y divide-border">
                {data.gems.map((g) => (
                  <li key={g.id}>
                    <Link href={`/gems/${g.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-surface-2/50 sm:px-5">
                      <span className="truncate">{g.title}</span>
                      <Money cents={g.asking_price_cents} className="text-fg-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Data sources" action={<LinkButton href="/settings/integrations" variant="ghost" size="sm">Manage</LinkButton>} />
            <CardBody className="flex flex-col gap-1.5 text-sm">
              <SourceRow label="Facebook Marketplace" status="Manual import" tone="neutral" />
              <SourceRow label="eBay discovery" status={ebayConfigured() ? (data.activeWatchlists ? `${data.activeWatchlists} watchlist(s)` : "Ready, no watchlists") : "Not connected"} tone={ebayConfigured() ? "positive" : "neutral"} />
              <SourceRow label="AI identification" status={aiConfigured() ? "Configured" : "Not configured"} tone={aiConfigured() ? "positive" : "neutral"} />
              <SourceRow label="Drive times" status={routingConfigured() ? "Google Routes" : "Manual entry"} tone={routingConfigured() ? "positive" : "neutral"} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function AttentionRow({ href, label, count, urgent }: { href: string; label: string; count: number; urgent?: boolean }) {
  return (
    <Link href={href} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-surface-2">
      <span className="text-fg-muted">{label}</span>
      <Badge tone={count > 0 ? (urgent ? "negative" : "accent") : "neutral"}>{count}</Badge>
    </Link>
  );
}

function SourceRow({ label, status, tone }: { label: string; status: string; tone: "positive" | "neutral" }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-fg-muted">{label}</span>
      <Badge tone={tone}>{status}</Badge>
    </div>
  );
}
