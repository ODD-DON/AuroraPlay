import "server-only";
import { businessSettingsSchema, resolveSettings, type BusinessSettings } from "@/domain/settings";
import {
  buyingPower,
  computeBalances,
  ownerContribution,
  summarize,
  type AccountCode,
  type BuyingPower,
  type FinancialSummary,
  type JournalEntry,
} from "@/domain/ledger";
import { num, type Queryable } from "@/server/db";

/* ---------------------------------- audit --------------------------------- */

export async function audit(
  q: Queryable,
  ownerId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  data: Record<string, unknown> = {},
  actor: "user" | "system" | "ai" | "worker" = "user",
) {
  await q.query(`insert into audit_logs (owner_id, actor, action, entity_type, entity_id, data) values ($1, $2, $3, $4, $5, $6)`, [
    ownerId,
    actor,
    action,
    entityType,
    entityId,
    data,
  ]);
}

/* -------------------------------- settings -------------------------------- */

export interface SettingsState {
  settings: BusinessSettings;
  onboardingCompleted: boolean;
}

export async function getSettings(q: Queryable, ownerId: string): Promise<SettingsState> {
  const [row] = await q.query<{ data: unknown; onboarding_completed: boolean }>(
    `select data, onboarding_completed from application_settings where owner_id = $1`,
    [ownerId],
  );
  return { settings: resolveSettings(row?.data), onboardingCompleted: row?.onboarding_completed ?? false };
}

export async function saveSettings(q: Queryable, ownerId: string, next: BusinessSettings, completeOnboarding = false) {
  const parsed = businessSettingsSchema.parse(next);
  await q.query(
    `insert into application_settings (owner_id, data, onboarding_completed, updated_at)
     values ($1, $2, $3, now())
     on conflict (owner_id) do update set data = excluded.data,
       onboarding_completed = application_settings.onboarding_completed or excluded.onboarding_completed,
       updated_at = now()`,
    [ownerId, parsed, completeOnboarding],
  );
  await audit(q, ownerId, completeOnboarding ? "onboarding.completed" : "settings.updated", "application_settings", null);
  if (completeOnboarding) {
    await postEntry(q, ownerId, ownerContribution(parsed.startingCapitalCents, new Date().toISOString(), "Opening bankroll", "opening-capital"));
  }
}

/* --------------------------------- ledger --------------------------------- */

/** Posts a balanced journal entry. Idempotent on external_ref: a repeated event returns the existing entry. */
export async function postEntry(q: Queryable, ownerId: string, entry: JournalEntry): Promise<{ id: string; duplicate: boolean }> {
  if (entry.externalRef) {
    const [existing] = await q.query<{ id: string }>(`select id from financial_entries where owner_id = $1 and external_ref = $2`, [
      ownerId,
      entry.externalRef,
    ]);
    if (existing) return { id: existing.id, duplicate: true };
  }
  const [row] = await q.query<{ id: string }>(
    `insert into financial_entries (owner_id, kind, memo, occurred_at, external_ref) values ($1, $2, $3, $4, $5) returning id`,
    [ownerId, entry.kind, entry.memo, entry.occurredAt, entry.externalRef],
  );
  for (const line of entry.lines) {
    await q.query(
      `insert into financial_entry_lines (owner_id, entry_id, account_code, debit_cents, credit_cents, inventory_item_id) values ($1, $2, $3, $4, $5, $6)`,
      [ownerId, row!.id, line.account, line.debitCents, line.creditCents, line.inventoryItemId ?? null],
    );
  }
  return { id: row!.id, duplicate: false };
}

export async function getFinancialSummary(q: Queryable, ownerId: string, until?: Date): Promise<FinancialSummary> {
  const rows = await q.query<{ account_code: AccountCode; d: unknown; c: unknown }>(
    `select l.account_code, sum(l.debit_cents) as d, sum(l.credit_cents) as c
       from financial_entry_lines l join financial_entries e on e.id = l.entry_id
      where l.owner_id = $1 and ($2::timestamptz is null or e.occurred_at <= $2)
      group by l.account_code`,
    [ownerId, until?.toISOString() ?? null],
  );
  return summarize(computeBalances(rows.map((r) => ({ account: r.account_code, debitCents: num(r.d), creditCents: num(r.c) }))));
}

export async function getCommittedCents(q: Queryable, ownerId: string): Promise<number> {
  const [row] = await q.query<{ total: unknown }>(
    `select coalesce(sum(n.agreed_price_cents), 0) as total
       from negotiations n join opportunities o on o.id = n.opportunity_id
      where n.owner_id = $1 and n.status = 'agreed' and o.status not in ('purchased', 'listed', 'sold')`,
    [ownerId],
  );
  return num(row?.total);
}

export async function getBuyingPower(q: Queryable, ownerId: string, settings: BusinessSettings): Promise<BuyingPower & { summary: FinancialSummary }> {
  const summary = await getFinancialSummary(q, ownerId);
  const committed = await getCommittedCents(q, ownerId);
  return { ...buyingPower(summary, settings.cashReserveBps, committed), summary };
}

/* --------------------------------- alerts --------------------------------- */

export type AlertKind =
  | "strong_buy" | "worth_the_drive" | "hidden_gem" | "price_drop" | "seller_counteroffer" | "new_verified_comps"
  | "deal_expiring" | "pickup_reminder" | "sold_item" | "shipment_needed" | "inventory_aging" | "profit_milestone" | "data_source_failure";

export async function createAlert(
  q: Queryable,
  ownerId: string,
  a: { kind: AlertKind; priority: "critical" | "high" | "normal" | "low"; title: string; body: string; link?: string; opportunityId?: string | null; dedupeKey: string },
): Promise<boolean> {
  const rows = await q.query<{ id: string }>(
    `insert into alerts (owner_id, opportunity_id, kind, priority, title, body, link, dedupe_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (owner_id, dedupe_key) do nothing returning id`,
    [ownerId, a.opportunityId ?? null, a.kind, a.priority, a.title, a.body, a.link ?? null, a.dedupeKey],
  );
  if (rows[0]) {
    await q.query(`insert into notifications (owner_id, alert_id, channel, status, sent_at) values ($1, $2, 'in_app', 'sent', now())`, [ownerId, rows[0].id]);
    return true;
  }
  return false;
}

export async function recordUsage(q: Queryable, ownerId: string, provider: string, operation: string, costMicrodollars: number, units = 1, detail: Record<string, unknown> = {}) {
  await q.query(`insert into api_usage (owner_id, provider, operation, units, cost_microdollars, detail) values ($1, $2, $3, $4, $5, $6)`, [
    ownerId,
    provider,
    operation,
    units,
    Math.max(0, Math.round(costMicrodollars)),
    detail,
  ]);
}

export async function monthToDateUsage(q: Queryable, ownerId: string): Promise<{ provider: string; costMicrodollars: number; calls: number }[]> {
  const rows = await q.query<{ provider: string; cost: unknown; calls: unknown }>(
    `select provider, coalesce(sum(cost_microdollars), 0) as cost, count(*) as calls from api_usage
      where owner_id = $1 and occurred_at >= date_trunc('month', now()) group by provider order by provider`,
    [ownerId],
  );
  return rows.map((r) => ({ provider: r.provider, costMicrodollars: num(r.cost), calls: num(r.calls) }));
}
