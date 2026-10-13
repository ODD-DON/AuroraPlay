import { Bell, Car, Plug, Settings, SlidersHorizontal } from "lucide-react";
import { savePreferencesAction, saveSettingsAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, CardBody, CardHeader, Field, Input, LinkButton, MoneyInput, Notice, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { EBAY_US_FEES } from "@/domain/fees";
import { formatBps, formatCents } from "@/domain/money";
import { asOwner } from "@/server/auth";
import { getSettings } from "@/server/services/core";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { s, prefs } = await asOwner(async (q, o) => ({
    s: (await getSettings(q, o)).settings,
    prefs: (await q.query<{ quiet_hours_start: number | null; quiet_hours_end: number | null; notification_channels: Record<string, boolean> }>(`select * from user_preferences where owner_id = $1`, [o]))[0],
  }));
  const v = s.travel.vehicle;
  return (
    <div className="flex flex-col gap-5 animate-in">
      <PageHeader icon={<Settings />} title="Settings" description="Your rules. Saving re-evaluates every open deal." actions={<LinkButton href="/settings/integrations" variant="secondary"><Plug /> Integrations</LinkButton>} />
      <ActionForm action={saveSettingsAction} className="gap-5">
        <Card>
          <CardHeader icon={<SlidersHorizontal />} title="Buying rules" />
          <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Home area label"><Input name="homeLabel" defaultValue={s.homeLabel} /></Field>
            <Field label="Private latitude" hint="Optional, improves routing. Never displayed."><Input name="homeLatitude" inputMode="decimal" defaultValue={s.homeLatitude ?? ""} /></Field>
            <Field label="Private longitude"><Input name="homeLongitude" inputMode="decimal" defaultValue={s.homeLongitude ?? ""} /></Field>
            <Field label="Minimum cash ROI (%)"><Input name="minRoi" type="number" step="0.5" defaultValue={s.minCashRoiBps / 100} /></Field>
            <Field label="Cash reserve (% of equity)"><Input name="cashReservePct" type="number" step="1" defaultValue={s.cashReserveBps / 100} /></Field>
            <Field label="Max single item (% of equity)"><Input name="maxSingleItemPct" type="number" step="1" defaultValue={s.maxSingleItemExposureBps / 100} /></Field>
            <Field label="Max speculative exposure (%)"><Input name="maxSpeculativePct" type="number" step="1" defaultValue={s.maxSpeculativeExposureBps / 100} /></Field>
            <Field label="Preferred resale horizon (days)"><Input name="preferredHorizonDays" type="number" defaultValue={s.preferredHorizonDays} /></Field>
            <Field label="Minimum sold comps"><Input name="minSoldComps" type="number" min="1" defaultValue={s.minSoldComps} /></Field>
            <Field label="Monthly software budget"><MoneyInput name="monthlyBudget" defaultValue={s.monthlySoftwareBudgetCents} /></Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader icon={<Car />} title="Travel and distance thresholds" description="Profit thresholds apply after purchase costs, fees, shipping, packaging, travel, and risk allowances." />
          <CardBody className="flex flex-col gap-4">
            <Table>
              <thead><tr><Th>Tier</Th><Th>Up to one-way minutes</Th><Th>Minimum net profit</Th><Th>Review</Th></tr></thead>
              <tbody>
                {s.travel.tiers.map((t) => (
                  <tr key={t.id}>
                    <Td className="font-medium">{t.label}</Td>
                    <Td>{t.maxOneWayMinutes === null ? <span className="text-fg-muted">No limit</span> : <Input name={`tier_${t.id}_max`} type="number" min="1" defaultValue={t.maxOneWayMinutes} className="w-24" />}</Td>
                    <Td><MoneyInput name={`tier_${t.id}_min`} defaultValue={t.minNetProfitCents} className="w-32" /></Td>
                    <Td className="text-xs text-fg-muted">{t.requiresManualReview ? "Manual review" : "Automatic"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Normal area (minutes)"><Input name="localAreaMinutes" type="number" defaultValue={s.travel.localAreaMinutes} /></Field>
              <Field label="Maximum travel (minutes)"><Input name="maxTravelMinutes" type="number" defaultValue={s.travel.maxTravelMinutes} /></Field>
              <Field label="Pickup and inspection (minutes)"><Input name="defaultPickupMinutes" type="number" defaultValue={s.travel.defaultPickupMinutes} /></Field>
              <Field label="Wasted-trip rate (%)" hint="No-shows and misdescribed items"><Input name="wastedTripPct" type="number" step="1" defaultValue={s.travel.wastedTripRateBps / 100} /></Field>
              <Field label="Your time value (per hour)" hint="Reported separately, never in profit"><MoneyInput name="ownerHourlyValue" defaultValue={s.travel.ownerHourlyValueCents} /></Field>
              <Field label="Min profit per hour outside local area"><MoneyInput name="minProfitPerHour" defaultValue={s.travel.minProfitPerHourOutsideLocalCents} /></Field>
              <Field label="Vehicle cost method" hint="Mileage rate already includes fuel and wear, so they are never added twice.">
                <Select name="vehicleMethod" defaultValue={v.method}><option value="mileage_rate">IRS-style mileage rate</option><option value="actual_expense">Actual fuel and wear</option></Select>
              </Field>
              <Field label="Mileage rate (cents per mile)"><Input name="mileageRateCents" type="number" step="0.5" defaultValue={v.method === "mileage_rate" ? v.rateCentsPerMile : 76} /></Field>
              <Field label="Fuel price (actual method)"><MoneyInput name="fuelPrice" defaultValue={v.method === "actual_expense" ? v.fuelPriceCentsPerGallon : 350} /></Field>
              <Field label="Miles per gallon"><Input name="mpg" type="number" step="0.5" defaultValue={v.method === "actual_expense" ? v.milesPerGallon : 25} /></Field>
              <Field label="Maintenance (cents per mile)"><Input name="maintenanceCpm" type="number" step="0.5" defaultValue={v.method === "actual_expense" ? v.maintenanceCentsPerMile : 10} /></Field>
              <Field label="Depreciation (cents per mile)"><Input name="depreciationCpm" type="number" step="0.5" defaultValue={v.method === "actual_expense" ? v.depreciationCentsPerMile : 15} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allowExceptionalTravel" defaultChecked={s.allowExceptionalTravel} className="size-4 accent-[var(--accent)]" /> Allow Worth the Drive deals outside the normal area</label>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Selling assumptions" description={`eBay fee schedule effective ${EBAY_US_FEES.effectiveDate}${EBAY_US_FEES.verified ? "" : " (pending your verification)"}`} />
          <CardBody className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Estimated buyer sales tax (%)" hint="eBay charges fees on tax collected"><Input name="buyerSalesTaxPct" type="number" step="0.25" defaultValue={s.buyerSalesTaxBps / 100} /></Field>
              <Field label="Packing supplies per item"><MoneyInput name="defaultPackaging" defaultValue={s.defaultPackagingCents} /></Field>
              <Field label="Listing and packing time (minutes)"><Input name="defaultHandlingMinutes" type="number" defaultValue={s.defaultHandlingMinutes} /></Field>
              <Field label="Returns allowance (%)"><Input name="returnsPct" type="number" step="0.5" defaultValue={s.defaultReturnsAllowanceBps / 100} /></Field>
              <Field label="Promoted listings ad rate (%)"><Input name="promotedPct" type="number" step="0.5" defaultValue={s.sellerAdjustments.promotedRateBps / 100} /></Field>
              <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="topRated" defaultChecked={s.sellerAdjustments.topRatedDiscountBps > 0} className="size-4 accent-[var(--accent)]" /> Top Rated Plus discount</label>
            </div>
            <Table>
              <thead><tr><Th>eBay category</Th><Th>Final value fee tiers</Th></tr></thead>
              <tbody>
                {EBAY_US_FEES.categories.map((c) => (
                  <tr key={c.id}><Td>{c.label}</Td><Td className="text-xs tabular">{c.tiers.map((t) => `${formatBps(t.rateBps, 2)}${t.upToCents ? ` to ${formatCents(t.upToCents, { compact: true })}` : " above"}`).join(", ")}</Td></tr>
                ))}
              </tbody>
            </Table>
            <Notice tone="caution">
              Per-order fee {formatCents(EBAY_US_FEES.perOrderFee!.atOrBelowCents)} at or below {formatCents(EBAY_US_FEES.perOrderFee!.thresholdCents)}, otherwise {formatCents(EBAY_US_FEES.perOrderFee!.aboveCents)}. {EBAY_US_FEES.notes}{" "}
              <a className="underline" href={EBAY_US_FEES.sourceUrl} target="_blank" rel="noopener noreferrer">Official fee page</a>
            </Notice>
          </CardBody>
        </Card>
        <div className="flex justify-end"><SubmitButton variant="primary" pendingLabel="Saving and re-evaluating">Save settings</SubmitButton></div>
      </ActionForm>

      <Card>
        <CardHeader icon={<Bell />} title="Notifications" description="High and critical alerts go to external channels. Critical alerts ignore quiet hours." />
        <CardBody>
          <ActionForm action={savePreferencesAction}>
            <div className="grid gap-4 sm:grid-cols-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="email" defaultChecked={!!prefs?.notification_channels?.email} className="size-4 accent-[var(--accent)]" /> Email</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="push" defaultChecked={!!prefs?.notification_channels?.push} className="size-4 accent-[var(--accent)]" /> Browser push</label>
              <Field label="Quiet hours start (0 to 23)"><Input name="quietStart" type="number" min="0" max="23" defaultValue={prefs?.quiet_hours_start ?? ""} /></Field>
              <Field label="Quiet hours end"><Input name="quietEnd" type="number" min="0" max="23" defaultValue={prefs?.quiet_hours_end ?? ""} /></Field>
            </div>
            <SubmitButton size="sm">Save notifications</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}
