import { Handshake } from "lucide-react";
import Link from "next/link";
import { Money, relativeTime } from "@/components/domain";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { asOwner } from "@/server/auth";
import { listNegotiations } from "@/server/services/negotiation";
import { NEGOTIATION_LABELS } from "./labels";

export const metadata = { title: "Negotiation Center" };
export const dynamic = "force-dynamic";


export default async function NegotiationsPage() {
  const rows = await asOwner((q, o) => listNegotiations(q, o));
  return (
    <div className="animate-in">
      <PageHeader icon={<Handshake />} title="Negotiation Center" description="Offers, counteroffers, and seller conversations. You send every message yourself; Resale Radar never contacts sellers." />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Handshake />} title="No negotiations yet" description="Start one from any deal with a calculated maximum price." action={<LinkButton href="/radar?decision=ACTIONABLE" variant="primary">Find a deal</LinkButton>} />
        ) : (
          <Table>
            <thead><tr><Th>Deal</Th><Th>Status</Th><Th className="text-right">Asking</Th><Th className="text-right">Max</Th><Th className="text-right">Agreed</Th><Th>Updated</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.opportunityId} className="hover:bg-surface-2/40">
                  <Td className="max-w-[300px]">
                    <Link href={`/negotiations/${r.opportunityId}`} className="font-medium hover:underline">{r.title}</Link>
                    {r.lastMessage ? <div className="truncate text-xs text-fg-muted">{r.lastMessage}</div> : null}
                  </Td>
                  <Td><Badge tone={NEGOTIATION_LABELS[r.status]?.tone ?? "neutral"}>{NEGOTIATION_LABELS[r.status]?.label ?? r.status}</Badge></Td>
                  <Td className="text-right"><Money cents={r.askingCents} /></Td>
                  <Td className="text-right"><Money cents={r.maxCents} /></Td>
                  <Td className="text-right"><Money cents={r.agreedCents} /></Td>
                  <Td className="whitespace-nowrap text-xs text-fg-muted">{relativeTime(r.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
