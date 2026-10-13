import { roundOfferDown, type Cents, formatCents } from "./money";

/**
 * Offer ladder and counteroffer evaluation. The maximum purchase price is a
 * hard ceiling: no suggested offer or acceptance ever exceeds it.
 */

export interface OfferLadder {
  openingOfferCents: Cents;
  targetPriceCents: Cents;
  maxPriceCents: Cents;
  askingPriceCents: Cents;
  /** False when the gap between asking and max is too wide to be worth pursuing. */
  worthPursuing: boolean;
  rationale: string;
}

export function buildOfferLadder(askingCents: Cents, maxCents: Cents | null, maxDiscountBps: number): OfferLadder | null {
  if (maxCents === null || maxCents <= 0) return null;
  const minReachable = Math.round((askingCents * (10_000 - maxDiscountBps)) / 10_000);

  if (askingCents <= maxCents) {
    const target = Math.min(askingCents, Math.max(roundOfferDown(Math.round(askingCents * 0.92)), 100));
    const opening = Math.min(target, Math.max(roundOfferDown(Math.round(askingCents * 0.82)), 100));
    return {
      openingOfferCents: opening,
      targetPriceCents: target,
      maxPriceCents: maxCents,
      askingPriceCents: askingCents,
      worthPursuing: true,
      rationale: `Asking price already meets your requirements. A modest offer is reasonable, but paying up to ${formatCents(Math.min(askingCents, maxCents))} still qualifies.`,
    };
  }

  const target = Math.min(maxCents, roundOfferDown(Math.round(maxCents * 0.95)) || maxCents);
  const opening = Math.min(target, roundOfferDown(Math.round(maxCents * 0.85)) || target);
  return {
    openingOfferCents: opening,
    targetPriceCents: target,
    maxPriceCents: maxCents,
    askingPriceCents: askingCents,
    worthPursuing: maxCents >= minReachable,
    rationale:
      maxCents >= minReachable
        ? `Attractive only at or below ${formatCents(maxCents)}. That is ${Math.round((1 - maxCents / askingCents) * 100)}% under asking.`
        : `Your maximum of ${formatCents(maxCents)} is more than ${maxDiscountBps / 100}% below asking, so a successful negotiation is unlikely.`,
  };
}

export type CounterDecision = "accept" | "counter" | "walk_away";

export interface CounterEvaluation {
  decision: CounterDecision;
  suggestedCounterCents: Cents | null;
  explanation: string;
}

export function evaluateCounteroffer(counterCents: Cents, ladder: OfferLadder, lastOfferCents: Cents | null): CounterEvaluation {
  if (counterCents <= ladder.targetPriceCents) {
    return { decision: "accept", suggestedCounterCents: null, explanation: `${formatCents(counterCents)} is at or below your target of ${formatCents(ladder.targetPriceCents)}.` };
  }
  if (counterCents <= ladder.maxPriceCents) {
    const midpoint = lastOfferCents === null ? ladder.targetPriceCents : Math.round((lastOfferCents + counterCents) / 2);
    const suggestion = Math.min(ladder.maxPriceCents, Math.max(roundOfferDown(midpoint), lastOfferCents ?? 0));
    if (suggestion >= counterCents) {
      return { decision: "accept", suggestedCounterCents: null, explanation: `${formatCents(counterCents)} is within your maximum.` };
    }
    return {
      decision: "counter",
      suggestedCounterCents: suggestion,
      explanation: `${formatCents(counterCents)} is acceptable (under your max of ${formatCents(ladder.maxPriceCents)}), but meeting in the middle at ${formatCents(suggestion)} is reasonable.`,
    };
  }
  return {
    decision: "walk_away",
    suggestedCounterCents: lastOfferCents !== null && lastOfferCents < ladder.maxPriceCents ? ladder.maxPriceCents : null,
    explanation: `${formatCents(counterCents)} exceeds your maximum of ${formatCents(ladder.maxPriceCents)}. You can offer your max once, then walk away.`,
  };
}

/** Deterministic but varied phrasing so messages do not read as templated. */
function pick<T>(items: readonly T[], seed: string): T {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return items[Math.abs(h) % items.length]!;
}

export interface MessageContext {
  seed: string;
  itemShortName: string;
  offerCents: Cents;
  canPickUpToday: boolean;
  conditional?: string;
}

export function draftOpeningMessage(ctx: MessageContext): string {
  const greeting = pick(["Hey", "Hi", "Hi there", "Hello"], ctx.seed);
  const avail = pick(
    [`is the ${ctx.itemShortName} still available?`, `is this still available?`, `are you still selling the ${ctx.itemShortName}?`],
    ctx.seed + "a",
  );
  const pickup = ctx.canPickUpToday
    ? pick(["I'm nearby and could pick it up today.", "I can come grab it today.", "I could pick it up later today."], ctx.seed + "p")
    : pick(["I could pick it up in the next day or two.", "I'm flexible on pickup time this week."], ctx.seed + "p");
  const offer = pick(
    [`Would you consider ${formatCents(ctx.offerCents)}?`, `Would you take ${formatCents(ctx.offerCents)}?`, `Any chance you'd do ${formatCents(ctx.offerCents)}?`],
    ctx.seed + "o",
  );
  const cond = ctx.conditional ? ` ${ctx.conditional}` : "";
  return `${greeting}, ${avail} ${pickup} ${offer}${cond}`.replace(/\s+/g, " ").trim();
}

export function draftCounterMessage(ctx: MessageContext): string {
  const thanks = pick(["Thanks for getting back to me.", "Appreciate the reply.", "Thanks for the quick response."], ctx.seed);
  const offer = pick(
    [`I could do ${formatCents(ctx.offerCents)}`, `Could you meet me at ${formatCents(ctx.offerCents)}?`, `Best I can do is ${formatCents(ctx.offerCents)}`],
    ctx.seed + "c",
  );
  const pickup = ctx.canPickUpToday ? pick([" and pick it up this evening", " and come by today"], ctx.seed + "p") : "";
  const cond = pick([" if everything works properly.", " as long as everything checks out.", "."], ctx.seed + "w");
  return `${thanks} ${offer}${pickup}${offer.endsWith("?") ? "" : cond}`.replace(/\s+/g, " ").trim();
}

export function draftPickupMessage(seed: string, when: string, place: string | null): string {
  const lead = pick(["Sounds good!", "Great, thank you!", "Perfect."], seed);
  const where = place ? ` at ${place}` : "";
  return `${lead} Does ${when}${where} work for you? I'll test it quickly when I get there and can pay cash.`;
}
