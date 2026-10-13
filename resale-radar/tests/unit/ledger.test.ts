import { describe, expect, it } from "vitest";
import {
  assertBalanced, buyingPower, capitalizeCost, computeBalances, expense, inventoryPurchase, ownerContribution,
  ownerWithdrawal, refundEntry, saleEntry, summarize, writeOffEntry, type JournalEntry,
} from "@/domain/ledger";

const at = "2026-10-13T12:00:00Z";
const lines = (entries: JournalEntry[]) => entries.flatMap((e) => e.lines);

describe("ledger", () => {
  const opening = ownerContribution(100_000, at, "Opening bankroll");
  const purchase = inventoryPurchase("item1", 10_000, 500, at, "PS5 bundle");
  const sale = saleEntry({ itemId: "item1", orderRef: "ord-1", itemPriceCents: 20_000, shippingChargedCents: 0, marketplaceFeesCents: 2_978, shippingLabelCents: 1_200, suppliesCents: 150, costBasisCents: 10_500, occurredAt: at });

  it("treats the opening bankroll as equity, not revenue or profit", () => {
    const s = summarize(computeBalances(opening.lines));
    expect(s.cashCents).toBe(100_000);
    expect(s.revenueCents).toBe(0);
    expect(s.netOperatingProfitCents).toBe(0);
    expect(s.equityCents).toBe(100_000);
  });

  it("moves purchases from cash to inventory without recording a loss", () => {
    const s = summarize(computeBalances(lines([opening, purchase])));
    expect(s.cashCents).toBe(89_500);
    expect(s.inventoryCostCents).toBe(10_500);
    expect(s.netOperatingProfitCents).toBe(0);
    expect(s.equityCents).toBe(100_000);
  });

  it("recognizes cost of goods sold and realized profit on sale", () => {
    const s = summarize(computeBalances(lines([opening, purchase, sale])));
    expect(s.inventoryCostCents).toBe(0);
    expect(s.cogsCents).toBe(10_500);
    expect(s.netOperatingProfitCents).toBe(20_000 - 10_500 - 2_978 - 1_200 - 150);
    expect(s.cashCents).toBe(105_172);
    expect(s.equityCents).toBe(s.cashCents + s.inventoryCostCents);
  });

  it("handles full refunds with restock and partial refunds", () => {
    const full = refundEntry({ itemId: "item1", refundRef: "r1", refundCents: 20_000, feeCreditCents: 2_938, returnShippingCents: 900, restockCostBasisCents: 10_500, occurredAt: at });
    const s = summarize(computeBalances(lines([opening, purchase, sale, full])));
    expect(s.inventoryCostCents).toBe(10_500);
    expect(s.equityCents).toBe(s.cashCents + s.inventoryCostCents);
    // Lost: per-order fee (40), outbound label, return label, supplies.
    expect(s.netOperatingProfitCents).toBe(-(40 + 1_200 + 900 + 150));

    const partial = refundEntry({ itemId: "item1", refundRef: "r2", refundCents: 2_000, feeCreditCents: 272, returnShippingCents: 0, restockCostBasisCents: 0, occurredAt: at });
    const p = summarize(computeBalances(lines([opening, purchase, sale, partial])));
    expect(p.netOperatingProfitCents).toBe(5_172 - 2_000 + 272);
  });

  it("records expenses, capitalized costs, write-offs, and withdrawals", () => {
    const all = [opening, purchase, capitalizeCost("item1", 1_000, at, "Repair"), expense("software", 2_000, at, "API usage"), writeOffEntry("item1", 11_500, at, "Damaged"), ownerWithdrawal(5_000, at)];
    const s = summarize(computeBalances(lines(all)));
    expect(s.inventoryCostCents).toBe(0);
    expect(s.netOperatingProfitCents).toBe(-13_500);
    expect(s.cashCents).toBe(100_000 - 11_500 - 2_000 - 5_000);
    expect(s.equityCents).toBe(s.cashCents);
  });

  it("rejects unbalanced or fractional entries", () => {
    expect(() => assertBalanced({ kind: "x", memo: "", occurredAt: at, externalRef: null, lines: [{ account: "cash", debitCents: 100, creditCents: 0 }] })).toThrow(/Unbalanced/);
    expect(() => assertBalanced({ kind: "x", memo: "", occurredAt: at, externalRef: null, lines: [{ account: "cash", debitCents: 1.5, creditCents: 0 }, { account: "owner_equity", debitCents: 0, creditCents: 1.5 }] })).toThrow(/integer/);
    expect(() => expense("cash", 100, at, "bad")).toThrow();
  });

  it("computes buying power after reserve and commitments", () => {
    const s = summarize(computeBalances(lines([opening, purchase])));
    const bp = buyingPower(s, 2_000, 5_000);
    expect(bp.reserveCents).toBe(20_000);
    expect(bp.availableCents).toBe(89_500 - 20_000 - 5_000);
  });
});
