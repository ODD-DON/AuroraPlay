import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { markAlertsReadAction } from "@/app/actions";
import { relativeTime } from "@/components/domain";
import { Badge, Button, Card, EmptyState, PageHeader, cn } from "@/components/ui";
import { asOwner } from "@/server/auth";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

const PRIORITY_TONE = { critical: "negative", high: "accent", normal: "neutral", low: "neutral" } as const;

export default async function AlertsPage() {
  const alerts = await asOwner((q) =>
    q.query<{ id: string; kind: string; priority: keyof typeof PRIORITY_TONE; title: string; body: string; link: string | null; read_at: Date | null; created_at: Date }>(
      `select id, kind, priority, title, body, link, read_at, created_at from alerts
        order by case priority when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, read_at nulls first, created_at desc limit 200`,
    ),
  );
  return (
    <div className="mx-auto max-w-3xl animate-in">
      <PageHeader
        icon={<Bell />}
        title="Notifications"
        description="Deduplicated and prioritized. Speculative discoveries are low priority by design."
        actions={<form action={markAlertsReadAction}><Button type="submit" size="sm"><CheckCheck /> Mark all read</Button></form>}
      />
      <Card>
        {alerts.length === 0 ? (
          <EmptyState icon={<Bell />} title="No notifications" />
        ) : (
          <ul className="divide-y divide-border">
            {alerts.map((a) => (
              <li key={a.id} className={cn("flex items-start gap-3 px-4 py-3 sm:px-5", a.read_at && "opacity-60")}>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", a.read_at ? "bg-transparent" : "bg-accent")} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={PRIORITY_TONE[a.priority]}>{a.priority}</Badge>
                    {a.link ? <Link href={a.link} className="font-medium hover:underline">{a.title}</Link> : <span className="font-medium">{a.title}</span>}
                  </div>
                  <p className="mt-0.5 text-sm text-fg-muted">{a.body}</p>
                  <p className="mt-0.5 text-[11px] text-fg-subtle">{a.kind.replace(/_/g, " ")} · {relativeTime(a.created_at)}</p>
                </div>
                {!a.read_at ? (
                  <form action={markAlertsReadAction}>
                    <input type="hidden" name="alertId" value={a.id} />
                    <Button type="submit" size="sm" variant="ghost">Read</Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
