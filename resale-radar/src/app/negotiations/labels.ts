export const NEGOTIATION_LABELS: Record<string, { label: string; tone: "neutral" | "accent" | "positive" | "caution" | "negative" }> = {
  not_started: { label: "Draft ready", tone: "neutral" },
  contacted: { label: "Contacted", tone: "accent" },
  offer_sent: { label: "Offer sent", tone: "accent" },
  countered: { label: "Seller countered", tone: "caution" },
  agreed: { label: "Agreed", tone: "positive" },
  declined: { label: "Declined", tone: "negative" },
  sold_elsewhere: { label: "Sold elsewhere", tone: "neutral" },
  abandoned: { label: "Abandoned", tone: "neutral" },
};
