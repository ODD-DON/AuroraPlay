import type { Bps, Cents } from "./money";
import { applyBps } from "./money";

/**
 * Double-entry business ledger.
 *
 * Every financial event produces balanced lines (debits equal credits).
 * Inventory purchases move value from cash to inventory; cost of goods sold
 * is recognized only when the item sells. Unrealized market value is never cash.
 */

export const ACCOUNTS = {
  cash: { type: "asset", label: "Cash" },
  inventory: { type: "asset", label: "Inventory (cost basis)" },
  owner_equity: { type: "equity", label: "Owner contributions" },
  owner_draws: { type: "equity", label: "Owner withdrawals" },
  sales_revenue: { type: "revenue", label: "Sales revenue" },
  shipping_income: { type: "revenue", label: "Shipping charged to buyers" },
  refunds: { type: "contra_revenue", label: "Refunds and returns" },
  cogs: { type: "expense", label: "Cost of goods sold" },
  marketplace_fees: { type: "expense", label: "Marketplace fees" },
  shipping_expense: { type: "expense", label: "Shipping and postage" },
  supplies: { type: "expense", label: "Packing supplies" },
  transportation: { type: "expense", label: "Transportation" },
  repairs: { type: "expense", label: "Repairs and testing" },
  software: { type: "expense", label: "Software and data" },
  write_offs: { type: "expense", label: "Inventory write-offs" },
  other_expense: { type: "expense", label: "Other expenses" },
} as const;

export type AccountCode = keyof typeof ACCOUNTS;
export type AccountType = (typeof ACCOUNTS)[AccountCode]["type"];

export interface LedgerLine {
  account: AccountCode;
  debitCents: Cents;
  creditCents: Cents;
  inventoryItemId?: string | null;
}

export interface JournalEntry {
  kind: string;
  memo: string;
  occurredAt: string;
  /** Idempotency key: the same external event can never post twice. */
  externalRef: string | null;
  lines: LedgerLine[];
}

const dr = (account: AccountCode, cents: Cents, inventoryItemId?: string | null): LedgerLine => ({ account, debitCents: cents, creditCents: 0, inventoryItemId });
const cr = (account: AccountCode, cents: Cents, inventoryItemId?: string | null): LedgerLine => ({ account, debitCents: 0, creditCents: cents, inventoryItemId });

export function assertBalanced(entry: JournalEntry): JournalEntry {
  let d = 0;
  let c = 0;
  for (const l of entry.lines) {
    if (!Number.isInteger(l.debitCents) || !Number.isInteger(l.creditCents)) throw new Error("Ledger amounts must be integer cents");
    if (l.debitCents < 0 || l.creditCents < 0) throw new Error("Ledger amounts cannot be negative");
    if (l.debitCents > 0 && l.creditCents > 0) throw new Error("A ledger line is either a debit or a credit");
    d += l.debitCents;
    c += l.creditCents;
  }
  if (d !== c) throw new Error(`Unbalanced entry "${entry.kind}": debits ${d} != credits ${c}`);
  return { ...entry, lines: entry.lines.filter((l) => l.debitCents > 0 || l.creditCents > 0) };
}

export function ownerContribution(cents: Cents, occurredAt: string, memo = "Owner contribution", externalRef: string | null = null): JournalEntry {
  return assertBalanced({ kind: "owner_contribution", memo, occurredAt, externalRef, lines: [dr("cash", cents), cr("owner_equity", cents)] });
}

export function ownerWithdrawal(cents: Cents, occurredAt: string, memo = "Owner withdrawal"): JournalEntry {
  return assertBalanced({ kind: "owner_withdrawal", memo, occurredAt, externalRef: null, lines: [dr("owner_draws", cents), cr("cash", cents)] });
}

/** Purchase price and capitalized acquisition costs become inventory cost basis. */
export function inventoryPurchase(itemId: string, purchaseCents: Cents, capitalizedCents: Cents, occurredAt: string, memo: string): JournalEntry {
  const total = purchaseCents + capitalizedCents;
  return assertBalanced({
    kind: "inventory_purchase",
    memo,
    occurredAt,
    externalRef: `purchase:${itemId}`,
    lines: [dr("inventory", total, itemId), cr("cash", total)],
  });
}

/** Costs added after purchase (repairs, parts) that increase cost basis. */
export function capitalizeCost(itemId: string, cents: Cents, occurredAt: string, memo: string, ref: string | null = null): JournalEntry {
  return assertBalanced({ kind: "capitalized_cost", memo, occurredAt, externalRef: ref, lines: [dr("inventory", cents, itemId), cr("cash", cents)] });
}

export function expense(account: AccountCode, cents: Cents, occurredAt: string, memo: string, ref: string | null = null): JournalEntry {
  if (ACCOUNTS[account].type !== "expense") throw new Error(`${account} is not an expense account`);
  return assertBalanced({ kind: "expense", memo, occurredAt, externalRef: ref, lines: [dr(account, cents), cr("cash", cents)] });
}

export interface SaleRecord {
  itemId: string;
  orderRef: string;
  itemPriceCents: Cents;
  shippingChargedCents: Cents;
  marketplaceFeesCents: Cents;
  shippingLabelCents: Cents;
  suppliesCents: Cents;
  costBasisCents: Cents;
  occurredAt: string;
}

/**
 * A completed sale. Payout is gross receipts minus fees withheld by the marketplace.
 * Shipping labels purchased through the marketplace are also withheld from payout.
 * Cost of goods sold is recognized from inventory at the same time.
 */
export function saleEntry(s: SaleRecord): JournalEntry {
  const payout = s.itemPriceCents + s.shippingChargedCents - s.marketplaceFeesCents - s.shippingLabelCents;
  const lines: LedgerLine[] = [
    dr("marketplace_fees", s.marketplaceFeesCents, s.itemId),
    dr("shipping_expense", s.shippingLabelCents, s.itemId),
    cr("sales_revenue", s.itemPriceCents, s.itemId),
    cr("shipping_income", s.shippingChargedCents, s.itemId),
    dr("cogs", s.costBasisCents, s.itemId),
    cr("inventory", s.costBasisCents, s.itemId),
    dr("supplies", s.suppliesCents, s.itemId),
    cr("cash", s.suppliesCents),
  ];
  if (payout >= 0) lines.push(dr("cash", payout));
  else lines.push(cr("cash", -payout));
  return assertBalanced({ kind: "sale", memo: `Sale ${s.orderRef}`, occurredAt: s.occurredAt, externalRef: `sale:${s.orderRef}`, lines });
}

export interface RefundRecord {
  itemId: string;
  refundRef: string;
  refundCents: Cents;
  /** Fees the marketplace credited back to the seller. */
  feeCreditCents: Cents;
  returnShippingCents: Cents;
  /** When the item comes back sellable, its cost basis returns to inventory. */
  restockCostBasisCents: Cents;
  occurredAt: string;
}

export function refundEntry(r: RefundRecord): JournalEntry {
  const cashOut = r.refundCents + r.returnShippingCents - r.feeCreditCents;
  const lines: LedgerLine[] = [
    dr("refunds", r.refundCents, r.itemId),
    dr("shipping_expense", r.returnShippingCents, r.itemId),
    cr("marketplace_fees", r.feeCreditCents, r.itemId),
    dr("inventory", r.restockCostBasisCents, r.itemId),
    cr("cogs", r.restockCostBasisCents, r.itemId),
  ];
  if (cashOut >= 0) lines.push(cr("cash", cashOut));
  else lines.push(dr("cash", -cashOut));
  return assertBalanced({ kind: "refund", memo: `Refund ${r.refundRef}`, occurredAt: r.occurredAt, externalRef: `refund:${r.refundRef}`, lines });
}

export function writeOffEntry(itemId: string, costBasisCents: Cents, occurredAt: string, memo: string): JournalEntry {
  return assertBalanced({
    kind: "write_off",
    memo,
    occurredAt,
    externalRef: `writeoff:${itemId}`,
    lines: [dr("write_offs", costBasisCents, itemId), cr("inventory", costBasisCents, itemId)],
  });
}

export type Balances = Record<AccountCode, Cents>;

/** Natural-sign balances: assets and expenses are debit-normal; the rest are credit-normal. */
export function computeBalances(lines: readonly Pick<LedgerLine, "account" | "debitCents" | "creditCents">[]): Balances {
  const out = Object.fromEntries(Object.keys(ACCOUNTS).map((k) => [k, 0])) as Balances;
  for (const l of lines) {
    const type = ACCOUNTS[l.account].type;
    const debitNormal = type === "asset" || type === "expense" || type === "contra_revenue" || l.account === "owner_draws";
    out[l.account] += debitNormal ? l.debitCents - l.creditCents : l.creditCents - l.debitCents;
  }
  return out;
}

export interface FinancialSummary {
  cashCents: Cents;
  inventoryCostCents: Cents;
  contributedCents: Cents;
  withdrawnCents: Cents;
  revenueCents: Cents;
  refundsCents: Cents;
  netRevenueCents: Cents;
  cogsCents: Cents;
  grossProfitCents: Cents;
  operatingExpensesCents: Cents;
  netOperatingProfitCents: Cents;
  equityCents: Cents;
}

export function summarize(b: Balances): FinancialSummary {
  const revenueCents = b.sales_revenue + b.shipping_income;
  const netRevenueCents = revenueCents - b.refunds;
  const grossProfitCents = netRevenueCents - b.cogs;
  const operatingExpensesCents =
    b.marketplace_fees + b.shipping_expense + b.supplies + b.transportation + b.repairs + b.software + b.write_offs + b.other_expense;
  const netOperatingProfitCents = grossProfitCents - operatingExpensesCents;
  return {
    cashCents: b.cash,
    inventoryCostCents: b.inventory,
    contributedCents: b.owner_equity,
    withdrawnCents: b.owner_draws,
    revenueCents,
    refundsCents: b.refunds,
    netRevenueCents,
    cogsCents: b.cogs,
    grossProfitCents,
    operatingExpensesCents,
    netOperatingProfitCents,
    // Equity at cost: contributions minus withdrawals plus realized profit. Equals cash + inventory.
    equityCents: b.owner_equity - b.owner_draws + netOperatingProfitCents,
  };
}

export interface BuyingPower {
  cashCents: Cents;
  reserveCents: Cents;
  committedCents: Cents;
  availableCents: Cents;
}

/** Reserve is a share of equity at cost so it scales as the business grows. */
export function buyingPower(summary: FinancialSummary, reserveBps: Bps, committedCents: Cents): BuyingPower {
  const reserveCents = applyBps(Math.max(0, summary.equityCents), reserveBps);
  return {
    cashCents: summary.cashCents,
    reserveCents,
    committedCents,
    availableCents: Math.max(0, summary.cashCents - reserveCents - committedCents),
  };
}

export const GROWTH_MILESTONES_CENTS = [100_000, 250_000, 500_000, 1_000_000, 2_000_000, 3_000_000];
