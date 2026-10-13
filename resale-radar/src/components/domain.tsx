import { AlertTriangle, CircleHelp, Gem, Car, CircleCheck, Handshake, Ban, CircleSlash, Search } from "lucide-react";
import type { ReactNode } from "react";
import { DECISION_LABELS, type Decision } from "@/domain/evaluate";
import { formatBps, formatCents } from "@/domain/money";
import { Badge, cn } from "./ui";

const DECISION_STYLE: Record<Decision, { tone: "positive" | "accent" | "caution" | "negative" | "neutral"; icon: ReactNode }> = {
  STRONG_BUY: { tone: "positive", icon: <CircleCheck /> },
  WORTH_THE_DRIVE: { tone: "positive", icon: <Car /> },
  BUY_IF_NEGOTIATED: { tone: "accent", icon: <Handshake /> },
  HIDDEN_GEM: { tone: "caution", icon: <Gem /> },
  RESEARCH_REQUIRED: { tone: "caution", icon: <Search /> },
  PASS: { tone: "neutral", icon: <CircleSlash /> },
  UNAVAILABLE: { tone: "neutral", icon: <Ban /> },
};

export function DecisionBadge({ decision, className }: { decision: Decision | null | undefined; className?: string }) {
  if (!decision) return <Badge className={className}><CircleHelp />Not evaluated</Badge>;
  const s = DECISION_STYLE[decision];
  return (
    <Badge tone={s.tone} className={className}>
      {s.icon}
      {DECISION_LABELS[decision]}
    </Badge>
  );
}

export function Money({ cents, sign, className, colored = false }: { cents: number | null | undefined; sign?: boolean; className?: string; colored?: boolean }) {
  if (cents === null || cents === undefined) return <span className={cn("text-fg-subtle", className)}>Unknown</span>;
  return (
    <span className={cn("tabular", colored && cents > 0 && "text-positive", colored && cents < 0 && "text-negative", className)}>
      {formatCents(cents, { sign })}
    </span>
  );
}

export function Pct({ bps, className, colored, threshold }: { bps: number | null | undefined; className?: string; colored?: boolean; threshold?: number }) {
  if (bps === null || bps === undefined) return <span className={cn("text-fg-subtle", className)}>Unknown</span>;
  const good = threshold !== undefined ? bps >= threshold : bps > 0;
  return <span className={cn("tabular", colored && (good ? "text-positive" : bps < 0 ? "text-negative" : "text-caution"), className)}>{formatBps(bps)}</span>;
}

export function ConfidenceMeter({ value, label }: { value: number | null; label: string }) {
  const pct = value === null ? null : Math.round(value * 100);
  const tone = pct === null ? "bg-border" : pct >= 75 ? "bg-positive" : pct >= 50 ? "bg-caution" : "bg-negative";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs">
        <span className="text-fg-muted">{label}</span>
        <span className="tabular text-fg">{pct === null ? "Unknown" : `${pct}%`}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct ?? 0}%` }} />
      </div>
    </div>
  );
}

export function ScoreRing({ score }: { score: number | null }) {
  const s = score ?? 0;
  const tone = score === null ? "var(--border)" : s >= 75 ? "var(--positive)" : s >= 55 ? "var(--accent)" : s >= 40 ? "var(--caution)" : "var(--negative)";
  const c = 2 * Math.PI * 15;
  return (
    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center" title="Deal score: a ranking aid, not a probability">
      <svg viewBox="0 0 36 36" className="h-11 w-11 -rotate-90">
        <circle cx="18" cy="18" r="15" fill="none" stroke="var(--surface-2)" strokeWidth="3" />
        <circle cx="18" cy="18" r="15" fill="none" stroke={tone} strokeWidth="3" strokeDasharray={c} strokeDashoffset={c - (c * s) / 100} strokeLinecap="round" />
      </svg>
      <span className="absolute text-xs font-semibold tabular">{score ?? "-"}</span>
    </div>
  );
}

export function SeverityBadge({ severity }: { severity: "critical" | "high" | "medium" | "low" }) {
  const tone = severity === "critical" ? "negative" : severity === "high" ? "negative" : severity === "medium" ? "caution" : "neutral";
  return (
    <Badge tone={tone}>
      {severity === "critical" ? <AlertTriangle /> : null}
      {severity[0]!.toUpperCase() + severity.slice(1)}
    </Badge>
  );
}

export function sourceLabel(source: string | null | undefined): string {
  return (
    { facebook_marketplace: "Facebook Marketplace", ebay: "eBay", craigslist: "Craigslist", offerup: "OfferUp", manual: "Manual entry", other: "Web" }[source ?? ""] ??
    source ??
    "Unknown"
  );
}

export function relativeTime(d: Date | string | null | undefined): string {
  if (!d) return "never";
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const days = Math.round(h / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
