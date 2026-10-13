import { CircleCheck, CircleSlash, ExternalLink, Plug } from "lucide-react";
import { relativeTime } from "@/components/domain";
import { Badge, Card, CardBody, CardHeader, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { INTEGRATIONS, isConfigured, type Access } from "@/integrations/registry";
import { asOwner } from "@/server/auth";
import { isLocalMode } from "@/server/db";

export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

const ACCESS: Record<Access, { label: string; tone: "positive" | "accent" | "caution" | "negative" | "neutral" }> = {
  official: { label: "Official API", tone: "positive" },
  paid: { label: "Paid API", tone: "accent" },
  restricted: { label: "Restricted", tone: "caution" },
  unavailable: { label: "Unavailable", tone: "negative" },
  manual: { label: "Manual workflow", tone: "neutral" },
};

export default async function IntegrationsPage() {
  const { status, errors } = await asOwner(async (q) => ({
    status: await q.query<{ provider: string; healthy: boolean; detail: string; checked_at: Date }>(`select provider, healthy, detail, checked_at from data_source_status`),
    errors: await q.query<{ provider: string; message: string; occurred_at: Date }>(`select provider, message, occurred_at from integration_errors order by occurred_at desc limit 10`),
  }));
  return (
    <div className="flex flex-col gap-5 animate-in">
      <PageHeader icon={<Plug />} title="Integrations" description="What each data source can and cannot do, verified against official documentation on 2026-10-13. The app works with none of them connected." />
      <Notice tone="neutral">
        Credentials are read from server environment variables and never reach the browser. {isLocalMode() ? "This is a local workspace (embedded database). Set DATABASE_URL and Supabase keys to deploy." : "Connected to Supabase Postgres."} An integration is reported healthy only after a successful live call.
      </Notice>
      <div className="grid gap-4 md:grid-cols-2">
        {INTEGRATIONS.map((i) => {
          const configured = isConfigured(i);
          const st = status.find((s) => s.provider === i.id);
          return (
            <Card key={i.id}>
              <CardHeader
                title={i.name}
                description={i.summary}
                action={<Badge tone={ACCESS[i.access].tone}>{ACCESS[i.access].label}</Badge>}
              />
              <CardBody className="flex flex-col gap-3 text-sm">
                <ul className="flex flex-col gap-1">
                  {i.capabilities.map((c) => (
                    <li key={c.label} className="flex items-start gap-2">
                      {c.supported ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-positive" /> : <CircleSlash className="mt-0.5 size-4 shrink-0 text-fg-subtle" />}
                      <span>{c.label}{c.note ? <span className="text-fg-muted"> · {c.note}</span> : null}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-fg-muted">{i.decision}</p>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs">
                  {i.envVars.length ? (
                    <span className="flex items-center gap-2">
                      <Badge tone={configured ? "positive" : "neutral"}>{configured ? "Credentials present" : "Not configured"}</Badge>
                      {st ? <Badge tone={st.healthy ? "positive" : "negative"}>{st.healthy ? "Healthy" : "Failing"} {relativeTime(st.checked_at)}</Badge> : configured ? <Badge>Not yet tested</Badge> : null}
                    </span>
                  ) : (
                    <span className="text-fg-subtle">No credentials needed</span>
                  )}
                  <a href={i.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent">Docs <ExternalLink className="size-3" /></a>
                </div>
                {i.envVars.length && !configured ? <code className="rounded bg-bg-subtle px-2 py-1 text-[11px] text-fg-muted">{i.envVars.join(", ")}</code> : null}
              </CardBody>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader title="Recent integration errors" />
        {errors.length === 0 ? <CardBody className="text-sm text-fg-muted">None.</CardBody> : (
          <Table>
            <thead><tr><Th>Provider</Th><Th>Error</Th><Th>When</Th></tr></thead>
            <tbody>{errors.map((e, i) => <tr key={i}><Td>{e.provider}</Td><Td className="text-xs">{e.message}</Td><Td className="whitespace-nowrap text-xs">{relativeTime(e.occurred_at)}</Td></tr>)}</tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
