import { ArrowLeft, Car, ExternalLink, History, MapPin, RefreshCw } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { reevaluateAction } from "@/app/actions";
import { DecisionBadge, Money, relativeTime, ScoreRing, sourceLabel } from "@/components/domain";
import { Badge, Button, Card, CardBody, CardHeader, Notice } from "@/components/ui";
import { CATEGORY_LABELS } from "@/domain/settings";
import { aiConfigured } from "@/integrations/ai";
import { routingConfigured } from "@/integrations/routing";
import { asOwner } from "@/server/auth";
import { getOpportunityDetail, STATUS_LABELS } from "@/server/services/opportunities";
import { ActionPanel, AnalysisPanel, FactsPanel, FinancialPanel, HardFilters, IdentityPanel, MarketPanel, PhotoStrip, PurchasePanel, RiskPanel, TravelPanel } from "./panels";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await asOwner((q, o) => getOpportunityDetail(q, o, id));
  return { title: d?.opportunity.title ?? "Deal" };
}

export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const d = await asOwner((q, o) => getOpportunityDetail(q, o, id));
  if (!d) notFound();
  const o = d.opportunity;
  const ev = d.evaluation;
  const pricePath = d.priceHistory.length > 1 ? d.priceHistory : null;

  return (
    <div className="flex flex-col gap-5 animate-in">
      <Link href="/radar" className="inline-flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" /> Deal Radar</Link>

      {sp.dup ? <Notice tone="accent">You had already imported this listing. Its latest price was recorded and the deal re-evaluated.</Notice> : null}

      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <DecisionBadge decision={o.decision} />
                <Badge>{STATUS_LABELS[o.status]}</Badge>
                {o.requires_manual_review ? <Badge tone="caution">Manual review required</Badge> : null}
                {o.category ? <Badge>{CATEGORY_LABELS[o.category] ?? o.category}</Badge> : null}
              </div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{o.title}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
                <span>{sourceLabel(d.listing?.source)}</span>
                {d.listing?.location_text ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{d.listing.location_text}</span> : null}
                {ev?.travel.oneWayMinutes != null && ev.travel.status !== "not_required" ? (
                  <span className="inline-flex items-center gap-1"><Car className="size-3.5" />{ev.travel.oneWayMinutes} min{ev.travel.status === "provisional" ? " (provisional)" : ""}</span>
                ) : null}
                {d.listing?.seller_name ? <span>Seller: {d.listing.seller_name}</span> : null}
                <span>Seen {relativeTime(d.listing?.last_observed_at ?? o.created_at)}</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-fg-muted">Asking</div>
                <div className="text-2xl font-semibold tabular"><Money cents={o.asking_price_cents} /></div>
                {pricePath ? <div className="text-xs text-fg-muted">was <Money cents={pricePath[0]!.price_cents} /></div> : null}
              </div>
              <ScoreRing score={o.score} />
            </div>
          </div>
          <PhotoStrip d={d} />
          <div className="flex flex-wrap gap-2">
            {d.listing?.canonical_url ? (
              <a href={d.listing.canonical_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 text-xs font-medium hover:border-border-strong">
                Open original listing <ExternalLink className="size-3.5" />
              </a>
            ) : null}
            <form action={reevaluateAction}>
              <input type="hidden" name="opportunityId" value={o.id} />
              <Button size="sm" type="submit"><RefreshCw /> Re-evaluate</Button>
            </form>
          </div>
        </CardBody>
      </Card>

      {ev ? (
        <Card>
          <CardHeader title={ev.decisionReason} description={`Evaluated ${relativeTime(ev.computedAt)} · version ${o.evaluation_version}`} />
          <CardBody><HardFilters ev={ev} /></CardBody>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          <FinancialPanel d={d} />
          <MarketPanel d={d} />
          <AnalysisPanel d={d} />
          <IdentityPanel d={d} aiAvailable={aiConfigured()} />
          {d.listing?.description ? (
            <Card>
              <CardHeader title="Seller description" description="Shown as written by the seller." />
              <CardBody><p className="whitespace-pre-line text-sm text-fg-muted">{d.listing.description}</p></CardBody>
            </Card>
          ) : null}
        </div>
        <div className="flex flex-col gap-5">
          <ActionPanel d={d} />
          <TravelPanel d={d} routingAvailable={routingConfigured()} />
          <FactsPanel d={d} />
          <RiskPanel d={d} />
          <PurchasePanel d={d} />
          <Card>
            <CardHeader icon={<History />} title="History" />
            <ul className="divide-y divide-border text-sm">
              {d.statusEvents.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-2 px-4 py-2 sm:px-5">
                  <span>{STATUS_LABELS[e.to_status as keyof typeof STATUS_LABELS] ?? e.to_status}{e.note ? <span className="text-fg-muted"> · {e.note}</span> : null}</span>
                  <span className="shrink-0 text-xs text-fg-subtle">{relativeTime(e.created_at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
