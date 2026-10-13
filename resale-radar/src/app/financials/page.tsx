import { Download, Target, Wallet } from "lucide-react";
import { contributionAction, expenseAction, withdrawalAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Money } from "@/components/domain";
import { Card, CardBody, CardHeader, Field, Input, KeyValue, MoneyInput, PageHeader, Progress, Select, Stat, Table, Td, Th, cn } from "@/components/ui";
import { ACCOUNTS, GROWTH_MILESTONES_CENTS } from "@/domain/ledger";
import { formatCents } from "@/domain/money";
import { asOwner } from "@/server/auth";
import { getBuyingPower, getSettings, monthToDateUsage } from "@/server/services/core";
import { EXPENSE_ACCOUNTS, listJournal } from "@/server/services/inventory";

export const metadata = { title: "Financials" };
export const dynamic = "force-dynamic";

export default async function FinancialsPage() {
  const { bp, settings, journal, usage } = await asOwner(async (q, o) => {
    const { settings } = await getSettings(q, o);
    return { settings, bp: await getBuyingPower(q, o, settings), journal: await listJournal(q, o, 300), usage: await monthToDateUsage(q, o) };
  });
  const s = bp.summary;
  const softwareMtd = Math.round(usage.reduce((a, u) => a + u.costMicrodollars, 0) / 10_000);
  const entries = new Map<string, { kind: string; memo: string; occurredAt: Date; lines: typeof journal }>();
  for (const l of journal) {
    const e = entries.get(l.entryId) ?? { kind: l.kind, memo: l.memo, occurredAt: l.occurredAt, lines: [] };
    e.lines.push(l);
    entries.set(l.entryId, e);
  }
  const goal = 3_000_000;
  return (
    <div className="flex flex-col gap-5 animate-in">
      <PageHeader
        icon={<Wallet />}
        title="Financials"
        description="A double-entry ledger. Purchases move cash into inventory; profit is recognized only when items sell."
        actions={<a href="/api/export/journal" className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface-2 px-4 text-sm font-medium hover:border-border-strong"><Download className="size-4" /> Export CSV</a>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardBody><Stat label="Cash" value={formatCents(s.cashCents)} /></CardBody></Card>
        <Card><CardBody><Stat label="Inventory (cost basis)" value={formatCents(s.inventoryCostCents)} /></CardBody></Card>
        <Card><CardBody><Stat label="Buying power" value={formatCents(bp.availableCents)} sub={`after ${formatCents(bp.reserveCents)} reserve and ${formatCents(bp.committedCents)} committed`} /></CardBody></Card>
        <Card><CardBody><Stat label="Equity at cost" value={formatCents(s.equityCents)} sub="Cash plus inventory at cost" /></CardBody></Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profit and loss (all time)" description="Realized only. Unsold inventory is not profit." />
          <CardBody>
            <KeyValue
              items={[
                { k: "Sales revenue (incl. shipping charged)", v: formatCents(s.revenueCents) },
                { k: "Refunds", v: formatCents(-s.refundsCents) },
                { k: "Net revenue", v: formatCents(s.netRevenueCents) },
                { k: "Cost of goods sold", v: formatCents(-s.cogsCents) },
                { k: "Gross profit", v: formatCents(s.grossProfitCents), strong: true },
                { k: "Operating expenses (fees, shipping, travel, supplies, software, write-offs)", v: formatCents(-s.operatingExpensesCents) },
                { k: "Net operating profit", v: <Money cents={s.netOperatingProfitCents} colored />, strong: true },
              ]}
            />
            <p className="mt-3 text-xs text-fg-muted">Income tax is not an operating expense and is not included. Export the ledger for your tax preparer.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Target />} title="Bankroll growth" description="Actual equity at cost, not projections." />
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-semibold tabular">{formatCents(s.equityCents)}</span>
              <span className="text-sm text-fg-muted">of {formatCents(goal, { compact: true })} goal</span>
            </div>
            <Progress value={(s.equityCents / goal) * 100} tone="positive" />
            <ol className="flex flex-col gap-1.5">
              {GROWTH_MILESTONES_CENTS.map((m) => (
                <li key={m} className="flex items-center justify-between text-sm">
                  <span className={cn(s.equityCents >= m ? "text-positive" : "text-fg-muted")}>{formatCents(m, { compact: true })}</span>
                  <span className="text-xs text-fg-subtle">{s.equityCents >= m ? "Reached" : `${formatCents(m - s.equityCents)} to go`}</span>
                </li>
              ))}
            </ol>
            <p className="text-xs text-fg-muted">Started with {formatCents(settings.startingCapitalCents)} owner capital. Contributions {formatCents(s.contributedCents)}, withdrawals {formatCents(s.withdrawnCents)}. Software this month {formatCents(softwareMtd)} of {formatCents(settings.monthlySoftwareBudgetCents)} budget.</p>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <Card>
          <CardHeader title="Add capital" />
          <CardBody>
            <ActionForm action={contributionAction} resetOnSuccess>
              <Field label="Amount"><MoneyInput name="amount" required /></Field>
              <Field label="Note"><Input name="note" /></Field>
              <SubmitButton size="sm">Record contribution</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Withdraw" />
          <CardBody>
            <ActionForm action={withdrawalAction} resetOnSuccess>
              <Field label="Amount"><MoneyInput name="amount" required /></Field>
              <Field label="Note"><Input name="note" /></Field>
              <SubmitButton size="sm">Record withdrawal</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Business expense" />
          <CardBody>
            <ActionForm action={expenseAction} resetOnSuccess>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Category"><Select name="account">{EXPENSE_ACCOUNTS.map((a) => <option key={a} value={a}>{ACCOUNTS[a].label}</option>)}</Select></Field>
                <Field label="Amount"><MoneyInput name="amount" required /></Field>
              </div>
              <Field label="Vendor"><Input name="vendor" /></Field>
              <SubmitButton size="sm">Record expense</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Journal" description="Every entry is balanced. Corrections are posted as new entries." />
        <Table>
          <thead><tr><Th>Date</Th><Th>Entry</Th><Th>Account</Th><Th className="text-right">Debit</Th><Th className="text-right">Credit</Th></tr></thead>
          <tbody>
            {[...entries.entries()].map(([id, e]) =>
              e.lines.map((l, i) => (
                <tr key={`${id}-${i}`} className={i === 0 ? "border-t-2 border-border" : ""}>
                  <Td className="whitespace-nowrap text-xs">{i === 0 ? new Date(e.occurredAt).toLocaleDateString("en-US") : ""}</Td>
                  <Td className="text-xs">{i === 0 ? e.memo : ""}</Td>
                  <Td className="text-xs">{ACCOUNTS[l.account as keyof typeof ACCOUNTS]?.label ?? l.account}</Td>
                  <Td className="text-right text-xs">{l.debitCents ? formatCents(l.debitCents) : ""}</Td>
                  <Td className="text-right text-xs">{l.creditCents ? formatCents(l.creditCents) : ""}</Td>
                </tr>
              )),
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
