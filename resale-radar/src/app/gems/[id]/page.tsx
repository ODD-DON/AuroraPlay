import { ArrowLeft, Camera, Check, ClipboardList, Gem, ScrollText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DecisionBadge, Money } from "@/components/domain";
import { Badge, Card, CardBody, CardHeader, LinkButton, Notice } from "@/components/ui";
import { CATEGORY_RISK } from "@/domain/risk";
import { aiConfigured } from "@/integrations/ai";
import { asOwner } from "@/server/auth";
import { getOpportunityDetail } from "@/server/services/opportunities";
import { FactsPanel, IdentityPanel, MarketPanel, PhotoStrip, RiskPanel } from "../../deals/[id]/panels";

export const metadata = { title: "Gem research" };
export const dynamic = "force-dynamic";

const SPECIAL_RULES: Record<string, string[]> = {
  artwork: ["Determine original vs print vs limited edition vs reproduction (texture, brush strokes, dot pattern under magnification).", "Photograph signature, edition number, and labels on the back.", "Record provenance; attribution without evidence is speculation."],
  sports_cards: ["Match year, manufacturer, set, player, card number, parallel, serial numbering, and autograph.", "Never use a PSA 10 price for an ungraded copy; compare like-for-like grade.", "Verify slab certificates on the grader's website."],
  trading_cards: ["Match set, number, edition, language, and holo pattern.", "Graded and raw cards are different markets."],
  video_games: ["Match region, platform, edition, and complete-in-box status.", "Check cartridge labels and boards for reproductions."],
  dolls: ["Photograph manufacturer marks on neck, back, and feet.", "Check for reproduction indicators and replaced parts or clothing."],
  watches: ["Serial, reference, caseback, and movement must match a genuine reference.", "Do not assume authenticity from photos."],
  jewelry: ["Precious metals and stones require testing; hallmarks can be faked.", "Value at melt or tested value only."],
  handbags: ["Authenticate through a recognized service before valuing as genuine."],
  electronics: ["Model number, storage, memory, accessories, battery health, activation and device-management locks, repair history, functionality."],
};

export default async function GemWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await asOwner((q, o) => getOpportunityDetail(q, o, id));
  if (!d) notFound();
  const o = d.opportunity;
  const cat = o.category ?? "other";
  const photosNeeded = [...new Set(d.candidates.flatMap((c) => c.required_photos))];
  const auth = CATEGORY_RISK[cat]?.authenticationRequired;
  return (
    <div className="flex flex-col gap-5 animate-in">
      <Link href="/gems" className="inline-flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" /> Hidden Gems</Link>
      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="mb-1 flex flex-wrap gap-2"><DecisionBadge decision={o.decision} />{o.hidden_gem_flag ? <Badge tone="caution"><Gem /> Hidden gem signal</Badge> : null}</div>
              <h1 className="text-xl font-semibold tracking-tight">{o.title}</h1>
              <p className="text-sm text-fg-muted">Asking <Money cents={o.asking_price_cents} /> {d.listing?.location_text ? `· ${d.listing.location_text}` : ""}</p>
            </div>
            <LinkButton href={`/deals/${o.id}`} variant="secondary">Full deal analysis</LinkButton>
          </div>
          {o.hidden_gem_rationale ? <Notice tone="caution" title="Why this might be valuable (hypothesis)">{o.hidden_gem_rationale}</Notice> : null}
          <PhotoStrip d={d} />
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <IdentityPanel d={d} aiAvailable={aiConfigured()} />
          <MarketPanel d={d} />
        </div>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader icon={<ClipboardList />} title="Research status" />
            <CardBody className="flex flex-col gap-2 text-sm">
              <Step done={o.identity_status === "verified"} label="Identity confirmed by you" />
              <Step done={!auth || o.authenticity_status === "verified" || o.authenticity_status === "not_required"} label={auth ? "Authenticity evidence recorded" : "Authentication not required for category"} />
              <Step done={(d.evaluation?.valuation.sampleSize ?? 0) >= 3} label="Three or more qualifying sold comps" />
              <Step done={d.liquidity !== null} label="Demand (sold and active counts) recorded" />
              <Step done={!!d.route} label="Drive time recorded" />
              <p className="mt-2 text-xs text-fg-muted">When all steps are complete, the deal is evaluated like any other and can qualify as Strong Buy or Worth the Drive.</p>
            </CardBody>
          </Card>
          {photosNeeded.length ? (
            <Card>
              <CardHeader icon={<Camera />} title="Ask the seller for" />
              <CardBody><ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">{photosNeeded.map((p) => <li key={p}>{p}</li>)}</ul></CardBody>
            </Card>
          ) : null}
          {SPECIAL_RULES[cat] ? (
            <Card>
              <CardHeader icon={<ScrollText />} title="Valuation rules for this category" />
              <CardBody><ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">{SPECIAL_RULES[cat]!.map((r) => <li key={r}>{r}</li>)}</ul></CardBody>
            </Card>
          ) : null}
          <FactsPanel d={d} />
          <RiskPanel d={d} />
        </div>
      </div>
    </div>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`flex size-4 items-center justify-center rounded-full border text-[10px] ${done ? "border-positive bg-positive text-accent-fg" : "border-border-strong"}`}>{done ? <Check className="size-3" /> : null}</span>
      <span className={done ? "" : "text-fg-muted"}>{label}</span>
    </div>
  );
}
