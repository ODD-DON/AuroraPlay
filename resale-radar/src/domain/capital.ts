import { applyBps, type Bps, type Cents } from "./money";

/**
 * Capital allocation across simultaneously qualifying deals.
 *
 * Objective: maximize total conservative net profit, subject to buying power,
 * a single-item exposure cap, and a cap on speculative exposure. Ties prefer
 * faster cash recovery. Exact search for up to 20 candidates, greedy beyond.
 */

export interface AllocationCandidate {
  id: string;
  label: string;
  cashRequiredCents: Cents;
  conservativeNetCents: Cents;
  expectedDaysToCash: number | null;
  speculative: boolean;
  category: string | null;
}

export interface AllocationConstraints {
  buyingPowerCents: Cents;
  equityCents: Cents;
  maxSingleItemExposureBps: Bps;
  maxSpeculativeExposureBps: Bps;
  /** Committed speculative exposure already in inventory. */
  existingSpeculativeCents: Cents;
}

export interface AllocationResult {
  selectedIds: string[];
  totalCashCents: Cents;
  totalConservativeNetCents: Cents;
  excluded: { id: string; reason: string }[];
  method: "exact" | "greedy";
}

export function allocateCapital(candidates: readonly AllocationCandidate[], c: AllocationConstraints): AllocationResult {
  const singleCap = applyBps(c.equityCents, c.maxSingleItemExposureBps);
  const specCap = Math.max(0, applyBps(c.equityCents, c.maxSpeculativeExposureBps) - c.existingSpeculativeCents);
  const excluded: { id: string; reason: string }[] = [];
  const eligible = candidates.filter((x) => {
    if (x.conservativeNetCents <= 0) excluded.push({ id: x.id, reason: "Conservative net profit is not positive" });
    else if (x.cashRequiredCents > singleCap) excluded.push({ id: x.id, reason: "Exceeds single-item exposure cap" });
    else if (x.cashRequiredCents > c.buyingPowerCents) excluded.push({ id: x.id, reason: "Exceeds available buying power" });
    else if (x.speculative && x.cashRequiredCents > specCap) excluded.push({ id: x.id, reason: "Exceeds speculative exposure cap" });
    else return true;
    return false;
  });

  const days = (x: AllocationCandidate) => x.expectedDaysToCash ?? 60;
  const better = (aNet: number, aDays: number, bNet: number, bDays: number) => aNet > bNet || (aNet === bNet && aDays < bDays);

  let best: { mask: number; net: number; cash: number; days: number } = { mask: 0, net: 0, cash: 0, days: 0 };
  let method: AllocationResult["method"] = "exact";

  if (eligible.length <= 20) {
    const n = eligible.length;
    for (let mask = 1; mask < 1 << n; mask++) {
      let cash = 0, net = 0, spec = 0, d = 0;
      let ok = true;
      for (let i = 0; i < n; i++) {
        if (!(mask & (1 << i))) continue;
        const x = eligible[i]!;
        cash += x.cashRequiredCents;
        net += x.conservativeNetCents;
        d += days(x) * x.cashRequiredCents;
        if (x.speculative) spec += x.cashRequiredCents;
        if (cash > c.buyingPowerCents || spec > specCap) { ok = false; break; }
      }
      if (!ok) continue;
      const weightedDays = cash ? d / cash : 0;
      if (better(net, weightedDays, best.net, best.days)) best = { mask, net, cash, days: weightedDays };
    }
  } else {
    method = "greedy";
    const order = eligible.map((x, i) => ({ x, i })).sort((a, b) => b.x.conservativeNetCents / b.x.cashRequiredCents - a.x.conservativeNetCents / a.x.cashRequiredCents);
    let cash = 0, net = 0, spec = 0;
    const selected: string[] = [];
    for (const { x } of order) {
      if (cash + x.cashRequiredCents > c.buyingPowerCents) continue;
      if (x.speculative && spec + x.cashRequiredCents > specCap) continue;
      cash += x.cashRequiredCents; net += x.conservativeNetCents; if (x.speculative) spec += x.cashRequiredCents;
      selected.push(x.id);
    }
    for (const x of eligible) if (!selected.includes(x.id)) excluded.push({ id: x.id, reason: "Lower priority than selected deals within buying power" });
    return { selectedIds: selected, totalCashCents: cash, totalConservativeNetCents: net, excluded, method };
  }

  const selectedIds = eligible.filter((_, i) => best.mask & (1 << i)).map((x) => x.id);
  for (const x of eligible) if (!selectedIds.includes(x.id)) excluded.push({ id: x.id, reason: "Lower total profit than the selected combination within buying power" });
  return { selectedIds, totalCashCents: best.cash, totalConservativeNetCents: best.net, excluded, method };
}
