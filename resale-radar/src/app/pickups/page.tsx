import { CalendarClock, Map, Route, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/domain";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { SAFETY_TIPS } from "@/domain/inspection";
import { formatCents } from "@/domain/money";
import { asOwner } from "@/server/auth";
import { listNegotiations } from "@/server/services/negotiation";
import { listFeed } from "@/server/services/opportunities";
import { listTrips } from "@/server/services/planning";
import { TripPlanner } from "./trip-planner";

export const metadata = { title: "Pickup Planner" };
export const dynamic = "force-dynamic";

export default async function PickupsPage() {
  const { agreed, candidates, trips } = await asOwner(async (q, o) => {
    const negs = await listNegotiations(q, o);
    const feed = await listFeed(q, o, { decision: "ACTIONABLE", status: "OPEN", limit: 30 });
    const negotiating = await listFeed(q, o, { status: "negotiating", limit: 30 });
    const seen = new Set<string>();
    const candidates = [...negotiating, ...feed].filter((f) => f.one_way_minutes !== null && f.one_way_minutes > 0 && !seen.has(f.id) && seen.add(f.id));
    return { agreed: negs.filter((n) => n.status === "agreed"), candidates, trips: await listTrips(q, o) };
  });
  const cashNeeded = agreed.reduce((a, n) => a + (n.agreedCents ?? 0), 0);
  return (
    <div className="flex flex-col gap-5 animate-in">
      <PageHeader icon={<Map />} title="Pickup Planner" description="Scheduled pickups, multi-stop routing with shared travel costs, and inspection checklists." />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader icon={<CalendarClock />} title="Agreed pickups" description={agreed.length ? `Bring ${formatCents(cashNeeded)} total` : undefined} />
            {agreed.length === 0 ? (
              <EmptyState title="No agreed pickups" description="Agreements recorded in the Negotiation Center appear here." />
            ) : (
              <Table>
                <thead><tr><Th>Deal</Th><Th>When</Th><Th>Where</Th><Th className="text-right">Cash</Th><Th></Th></tr></thead>
                <tbody>
                  {agreed.map((n) => (
                    <tr key={n.opportunityId}>
                      <Td className="font-medium">{n.title}</Td>
                      <Td className="whitespace-nowrap text-xs">{n.pickupAt ? new Date(n.pickupAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not set"}</Td>
                      <Td className="text-xs">{n.pickupPlace ?? "Not set"}</Td>
                      <Td className="text-right"><Money cents={n.agreedCents} /></Td>
                      <Td className="text-right"><Link href={`/deals/${n.opportunityId}#purchase`} className="text-xs text-accent hover:underline">Inspect and buy</Link></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader icon={<Route />} title="Plan a multi-stop trip" description="Groups pickups, finds the fastest order, and splits travel cost so no stop pays more than it would alone." />
            <CardBody>
              {candidates.length < 1 ? (
                <p className="text-sm text-fg-muted">Deals with recorded drive times appear here.</p>
              ) : (
                <TripPlanner candidates={candidates.map((c) => ({ id: c.id, title: c.title, minutes: c.one_way_minutes!, net: c.conservative_net_cents }))} />
              )}
            </CardBody>
          </Card>
          {trips.length ? (
            <Card>
              <CardHeader title="Planned trips" />
              <ul className="divide-y divide-border">
                {trips.map((t) => (
                  <li key={t.id} className="px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{t.name}</span>
                      <span className="text-xs text-fg-muted">{t.totalMinutes} min · {t.totalMiles} mi · travel {formatCents(t.tripCostCents)}</span>
                    </div>
                    <ol className="mt-2 flex flex-col gap-1 text-sm">
                      {t.stops.map((s) => (
                        <li key={s.opportunityId} className="flex items-center justify-between gap-2">
                          <span><Badge className="mr-2">{s.sequence}</Badge><Link href={`/deals/${s.opportunityId}`} className="hover:underline">{s.title}</Link></span>
                          <span className="text-xs text-fg-muted">share {formatCents(s.allocatedCostCents)}{s.cashNeededCents ? ` · cash ${formatCents(s.cashNeededCents)}` : ""}</span>
                        </li>
                      ))}
                    </ol>
                    {t.plan ? (
                      <p className="mt-2 text-xs text-fg-muted">
                        Combined net after travel {formatCents(t.plan.combinedNetCents)}; saves {formatCents(t.plan.savingsVsSeparateCents)} versus separate trips.
                        {t.plan.feasible ? "" : " Seller time windows conflict; confirm times."}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
        <Card className="h-fit">
          <CardHeader icon={<ShieldCheck />} title="Pickup safety" />
          <CardBody>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-muted">{SAFETY_TIPS.map((t) => <li key={t}>{t}</li>)}</ul>
            <p className="mt-3 text-xs text-fg-subtle">Inspection checklists for each category are on the deal page, under Inspect and record purchase.</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
