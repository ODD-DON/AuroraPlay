/**
 * Money is always stored and computed as integer cents.
 * Rates are integer basis points (1 bp = 0.01%, 10000 bps = 100%).
 * Floating point is only used transiently inside `applyBps` and is rounded
 * back to an integer immediately, so stored values are always exact.
 */

export type Cents = number;
export type Bps = number;

export const BPS_DENOMINATOR = 10_000;

export function assertCents(value: number, label = "amount"): Cents {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer number of cents, received ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} exceeds the safe integer range`);
  }
  return value;
}

/** Round half away from zero, which matches how marketplaces round fees. */
export function roundHalfAway(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function applyBps(amount: Cents, rate: Bps): Cents {
  return roundHalfAway((amount * rate) / BPS_DENOMINATOR);
}

export function sum(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function dollarsToCents(dollars: number | string): Cents {
  const n = typeof dollars === "string" ? Number(dollars.replace(/[$,\s]/g, "")) : dollars;
  if (!Number.isFinite(n)) throw new Error(`Invalid dollar amount: ${dollars}`);
  return roundHalfAway(n * 100);
}

export function percentToBps(percent: number): Bps {
  return roundHalfAway(percent * 100);
}

export function bpsToPercent(bps: Bps): number {
  return bps / 100;
}

/** Ratio of two cent amounts expressed in basis points. Null when undefined. */
export function ratioBps(numerator: Cents, denominator: Cents): Bps | null {
  if (denominator <= 0) return null;
  return roundHalfAway((numerator * BPS_DENOMINATOR) / denominator);
}

export function formatCents(cents: Cents | null | undefined, opts: { sign?: boolean; compact?: boolean } = {}): string {
  if (cents === null || cents === undefined) return "Unknown";
  const abs = Math.abs(cents) / 100;
  const digits = opts.compact && abs >= 1000 ? 0 : 2;
  const str = abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const prefix = cents < 0 ? "-" : opts.sign && cents > 0 ? "+" : "";
  return `${prefix}$${str}`;
}

export function formatBps(bps: Bps | null | undefined, digits = 0): string {
  if (bps === null || bps === undefined) return "Unknown";
  return `${(bps / 100).toFixed(digits)}%`;
}

/** Round down to a "human" offer increment ($5 under $200, $10 under $1000, else $25). */
export function roundOfferDown(cents: Cents): Cents {
  const step = cents < 20_000 ? 500 : cents < 100_000 ? 1_000 : 2_500;
  return Math.max(0, Math.floor(cents / step) * step);
}
