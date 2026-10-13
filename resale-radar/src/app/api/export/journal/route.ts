import { ACCOUNTS } from "@/domain/ledger";
import { getOwnerIdOrNull } from "@/server/auth";
import { withOwner } from "@/server/db";
import { listJournal } from "@/server/services/inventory";

function csv(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  // Neutralize spreadsheet formula injection and quote every field.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET() {
  const owner = await getOwnerIdOrNull();
  if (!owner) return new Response("Unauthorized", { status: 401 });
  const rows = await withOwner(owner, (q) => listJournal(q, owner, 100_000));
  const lines = [["date", "entry_id", "kind", "memo", "reference", "account", "account_name", "debit", "credit", "inventory_item_id"].map(csv).join(",")];
  for (const r of rows.reverse()) {
    lines.push(
      [new Date(r.occurredAt).toISOString().slice(0, 10), r.entryId, r.kind, r.memo, r.externalRef, r.account, ACCOUNTS[r.account as keyof typeof ACCOUNTS]?.label ?? r.account,
        (r.debitCents / 100).toFixed(2), (r.creditCents / 100).toFixed(2), r.inventoryItemId].map(csv).join(","),
    );
  }
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="resale-radar-ledger-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
