import { Radar } from "lucide-react";
import { redirect } from "next/navigation";
import { completeOnboardingAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, CardBody, CardHeader, Field, Input, MoneyInput, Select } from "@/components/ui";
import { ALL_CATEGORIES, CATEGORY_LABELS, DEFAULT_SETTINGS } from "@/domain/settings";
import { asOwner } from "@/server/auth";
import { getSettings } from "@/server/services/core";

export const metadata = { title: "Set up" };

export default async function OnboardingPage() {
  const { onboardingCompleted } = await asOwner((q, o) => getSettings(q, o));
  if (onboardingCompleted) redirect("/");
  const d = DEFAULT_SETTINGS;
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg">
          <Radar className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Resale Radar</h1>
          <p className="text-sm text-fg-muted">A few defaults so every deal is judged by your rules. You can change all of these later.</p>
        </div>
      </div>
      <ActionForm action={completeOnboardingAction} className="gap-4">
        <Card>
          <CardHeader title="Business basics" description="Your starting bankroll is recorded as owner capital, not revenue or profit." />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Starting location" hint="Your exact address stays private and is never shown elsewhere.">
              <Input name="homeLabel" defaultValue={d.homeLabel} required />
            </Field>
            <Field label="Starting capital">
              <MoneyInput name="startingCapital" defaultValue={d.startingCapitalCents} required />
            </Field>
            <Field label="Minimum net profit (local deals)" hint="After all fees, shipping, travel, and risk allowances.">
              <MoneyInput name="minNetProfit" defaultValue={d.travel.tiers[0]!.minNetProfitCents} />
            </Field>
            <Field label="Minimum cash ROI (%)">
              <Input name="minRoi" type="number" step="1" min="0" defaultValue={d.minCashRoiBps / 100} />
            </Field>
            <Field label="Typical max per item (% of capital)" hint="Limits concentration in a single item.">
              <Input name="maxSingleItemPct" type="number" min="1" max="100" defaultValue={d.maxSingleItemExposureBps / 100} />
            </Field>
            <Field label="Risk tolerance">
              <Select name="riskTolerance" defaultValue={d.riskTolerance}>
                <option value="conservative">Conservative (recommended)</option>
                <option value="balanced">Balanced</option>
                <option value="aggressive">Aggressive</option>
              </Select>
            </Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Travel" description="Distance is a cost, not a barrier. Longer drives need more profit." />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Normal search area (one-way minutes)">
              <Input name="localAreaMinutes" type="number" min="5" max="120" defaultValue={d.travel.localAreaMinutes} />
            </Field>
            <Field label="Maximum drive for exceptional deals (minutes)">
              <Input name="maxTravelMinutes" type="number" min="10" max="300" defaultValue={d.travel.maxTravelMinutes} />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="allowExceptionalTravel" defaultChecked className="size-4 accent-[var(--accent)]" />
              Show &quot;Worth the Drive&quot; deals beyond the normal area when verified profit justifies the trip
            </label>
            <p className="text-xs text-fg-muted sm:col-span-2">
              Default thresholds: $60 (0 to 20 min), $100 (21 to 30), $175 (31 to 45), $300 (46 to 60), $500 with manual review (over 60). Edit them in Settings.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Categories" description="All are on by default. Hidden-gem discovery is never limited to this list." />
          <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ALL_CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="categories" value={c} defaultChecked className="size-4 accent-[var(--accent)]" />
                {CATEGORY_LABELS[c]}
              </label>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Notifications and costs" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Monthly software budget" hint="AI, routing, and data costs stop when this is reached.">
              <MoneyInput name="monthlyBudget" defaultValue={d.monthlySoftwareBudgetCents} />
            </Field>
            <div className="flex flex-col gap-2 text-sm">
              <span className="text-xs font-medium text-fg-muted">Alert channels (in-app is always on)</span>
              <label className="flex items-center gap-2"><input type="checkbox" name="notifyEmail" className="size-4 accent-[var(--accent)]" /> Email (needs a configured provider)</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="notifyPush" className="size-4 accent-[var(--accent)]" /> Browser push (needs VAPID keys)</label>
            </div>
            <p className="text-xs text-fg-muted sm:col-span-2">Negotiation messages are always drafted for your approval. Resale Radar never sends messages, makes offers, or pays on your behalf.</p>
          </CardBody>
        </Card>
        <div className="flex justify-end">
          <SubmitButton variant="primary" size="lg" pendingLabel="Setting up">Start using Resale Radar</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
