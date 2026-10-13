import { ListChecks, Play, Trash2 } from "lucide-react";
import { deleteWatchlistAction, runWatchlistAction, saveWatchlistAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { relativeTime } from "@/components/domain";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, MoneyInput, Notice, PageHeader, Select } from "@/components/ui";
import { formatBps, formatCents } from "@/domain/money";
import { CATEGORY_LABELS } from "@/domain/settings";
import { ebayConfigured } from "@/integrations/ebay";
import { asOwner } from "@/server/auth";
import { listWatchlists } from "@/server/services/planning";

export const metadata = { title: "Watchlists" };
export const dynamic = "force-dynamic";

const PRESETS = ["PS5 consoles", "Nintendo bundles", "Vintage stereo receivers", "DJ mixers and controllers", "Camera lenses", "Gaming PCs", "Bulk toy lots", "Vintage dolls"];

export default async function WatchlistsPage() {
  const lists = await asOwner((q, o) => listWatchlists(q, o));
  const ebay = ebayConfigured();
  return (
    <div className="flex flex-col gap-5 animate-in">
      <PageHeader icon={<ListChecks />} title="Watchlists" description="Saved searches with their own price, distance, profit, and evidence rules." />
      {!ebay ? (
        <Notice tone="caution" title="Watchlists are saved but not running">
          Automatic searching uses the eBay Browse API, which needs credentials (Settings, Integrations). Facebook Marketplace offers no authorized search API, so for Marketplace keep using its own saved searches and import the listings you get notified about.
        </Notice>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Your watchlists" />
          {lists.length === 0 ? (
            <EmptyState icon={<ListChecks />} title="No watchlists yet" description={`Ideas: ${PRESETS.join(", ")}.`} />
          ) : (
            <ul className="divide-y divide-border">
              {lists.map((w) => (
                <li key={w.id} className="flex flex-col gap-2 px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{w.name}</span>
                      <Badge tone={w.active ? "positive" : "neutral"}>{w.active ? "Active" : "Paused"}</Badge>
                      {w.sources.includes("ebay") ? <Badge>eBay</Badge> : null}
                    </div>
                    <div className="flex gap-1">
                      {ebay && w.sources.includes("ebay") ? (
                        <ActionForm action={runWatchlistAction} className="gap-1">
                          <input type="hidden" name="id" value={w.id} />
                          <SubmitButton size="sm" pendingLabel="Searching"><Play /> Run now</SubmitButton>
                        </ActionForm>
                      ) : null}
                      <form action={deleteWatchlistAction}>
                        <input type="hidden" name="id" value={w.id} />
                        <Button size="sm" variant="ghost" type="submit" aria-label="Delete watchlist"><Trash2 /></Button>
                      </form>
                    </div>
                  </div>
                  <p className="text-xs text-fg-muted">
                    {[
                      w.keywords.length ? `Keywords: ${w.keywords.join(", ")}` : null,
                      w.exclusions.length ? `Excluding: ${w.exclusions.join(", ")}` : null,
                      w.maxPriceCents ? `Up to ${formatCents(w.maxPriceCents)}` : null,
                      w.maxTravelMinutes ? `Within ${w.maxTravelMinutes} min` : null,
                      w.minNetProfitCents ? `Net at least ${formatCents(w.minNetProfitCents)}` : null,
                      w.minRoiBps ? `ROI at least ${formatBps(w.minRoiBps)}` : null,
                      `Evidence: ${w.requiredEvidence}`,
                      `Every ${w.pollMinutes} min`,
                      `Last run ${relativeTime(w.lastRun)}`,
                    ].filter(Boolean).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="New watchlist" />
          <CardBody>
            <ActionForm action={saveWatchlistAction} resetOnSuccess>
              <input type="hidden" name="active" value="on" />
              <Field label="Name"><Input name="name" required placeholder="e.g. DJ controllers under $400" /></Field>
              <Field label="Keywords" hint="Comma-separated"><Input name="keywords" placeholder="ddj, pioneer, controller" /></Field>
              <Field label="Exclude words" hint="Comma-separated"><Input name="exclusions" placeholder="broken, parts, case only" /></Field>
              <Field label="Category">
                <Select name="categories" defaultValue=""><option value="">Any</option>{Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Min price"><MoneyInput name="minPrice" /></Field>
                <Field label="Max price"><MoneyInput name="maxPrice" /></Field>
                <Field label="Max drive (min)"><Input name="maxTravelMinutes" type="number" min="1" /></Field>
                <Field label="Check every (min)"><Input name="pollMinutes" type="number" min="5" defaultValue={60} /></Field>
                <Field label="Min net profit"><MoneyInput name="minNetProfit" /></Field>
                <Field label="Min ROI (%)"><Input name="minRoi" type="number" min="0" /></Field>
              </div>
              <Field label="Required evidence">
                <Select name="requiredEvidence" defaultValue="moderate"><option value="any">Any</option><option value="thin">Thin (1 to 3 comps)</option><option value="moderate">Moderate (4+)</option><option value="strong">Strong (8+)</option></Select>
              </Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sources" value="ebay" defaultChecked className="size-4 accent-[var(--accent)]" /> Search eBay automatically (when connected)</label>
              <SubmitButton variant="primary" size="sm">Save watchlist</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
