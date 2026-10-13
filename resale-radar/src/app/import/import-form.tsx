"use client";

import { Link2, Loader2, ScanText, Truck } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { extractScreenshotAction, importListingAction } from "@/app/actions";
import { ActionForm, FormMessage, SubmitButton } from "@/components/action-form";
import { Button, Card, CardBody, CardHeader, Field, Input, MoneyInput, Notice, Select, Textarea } from "@/components/ui";
import { CATEGORY_LABELS } from "@/domain/settings";

interface Extracted {
  title: string | null;
  asking_price_usd: number | null;
  location_text: string | null;
  seller_name: string | null;
  description: string | null;
  condition: string | null;
  marketplace: string;
}

export function ImportForm({ aiAvailable, initialUrl, initialTitle }: { aiAvailable: boolean; initialUrl: string; initialTitle: string }) {
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [shipped, setShipped] = useState(false);
  const [state, extractAction, extracting] = useActionState(extractScreenshotAction, null);

  useEffect(() => {
    if (state?.ok && state.data) {
      setExtracted(state.data as Extracted);
      setFormKey((k) => k + 1);
    }
  }, [state]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader icon={<ScanText />} title="Read a screenshot" description="Screenshot a Facebook Marketplace listing and let Claude fill in the details for you to review." />
        <CardBody>
          {aiAvailable ? (
            <form action={extractAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="Listing screenshot" className="flex-1">
                <Input type="file" name="screenshot" accept="image/*" required className="h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-xs file:text-fg" />
              </Field>
              <Button type="submit" disabled={extracting}>
                {extracting ? <Loader2 className="animate-spin" /> : <ScanText />}
                {extracting ? "Reading" : "Extract details"}
              </Button>
            </form>
          ) : (
            <Notice tone="neutral">Screenshot reading needs an Anthropic API key (Settings, Integrations). You can still attach the screenshot as a photo below and type the details.</Notice>
          )}
          <div className="mt-2">
            <FormMessage state={state} />
          </div>
        </CardBody>
      </Card>

      <ActionForm action={importListingAction} key={formKey}>
        <input type="hidden" name="importMethod" value={extracted ? "screenshot" : initialUrl ? "share" : "manual"} />
        <Card>
          <CardHeader icon={<Link2 />} title="Listing details" description="Only the title and price are required. More detail makes the evaluation better." />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Listing URL" hint="Facebook Marketplace, eBay, Craigslist, OfferUp, or any link. Repeat imports are detected." className="sm:col-span-2">
              <Input name="url" type="url" inputMode="url" placeholder="https://www.facebook.com/marketplace/item/..." defaultValue={initialUrl} />
            </Field>
            <Field label="Title" className="sm:col-span-2">
              <Input name="title" required maxLength={300} defaultValue={extracted?.title ?? initialTitle} placeholder="e.g. PS5 disc console with 2 controllers" />
            </Field>
            <Field label="Asking price">
              <MoneyInput name="askingPrice" required defaultValue={extracted?.asking_price_usd != null ? Math.round(extracted.asking_price_usd * 100) : undefined} />
            </Field>
            <Field label="Category">
              <Select name="category" defaultValue="">
                <option value="">Not sure (AI or you can set it later)</option>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Seller location" hint="Neighborhood or city is fine. Drive time will be marked provisional.">
              <Input name="locationText" defaultValue={extracted?.location_text ?? ""} placeholder="e.g. Romeoville, IL" />
            </Field>
            <Field label="Location precision">
              <Select name="locationPrecision" defaultValue="approximate">
                <option value="approximate">Approximate area</option>
                <option value="exact">Exact pickup address</option>
                <option value="unknown">Unknown</option>
              </Select>
            </Field>
            <Field label="Seller name (public display name)">
              <Input name="sellerName" defaultValue={extracted?.seller_name ?? ""} />
            </Field>
            <Field label="Condition (as listed)">
              <Input name="condition" defaultValue={extracted?.condition ?? ""} />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Textarea name="description" rows={4} defaultValue={extracted?.description ?? ""} placeholder="Paste the seller's description" />
            </Field>
            <Field label="Photos" hint="Up to 12 images. They are re-encoded and stripped of location metadata." className="sm:col-span-2">
              <Input type="file" name="photos" accept="image/*" multiple className="h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-xs file:text-fg" />
            </Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Truck />} title="Getting it" description="Drive time sets the profit threshold. Without it, the deal stays in research." />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" name="shipped" checked={shipped} onChange={(e) => setShipped(e.target.checked)} className="size-4 accent-[var(--accent)]" />
              Seller ships it to me (no pickup)
            </label>
            {!shipped ? (
              <>
                <Field label="One-way drive (minutes)" hint="From Google Maps or similar.">
                  <Input name="driveMinutes" type="number" min="0" max="600" inputMode="numeric" />
                </Field>
                <Field label="One-way distance (miles)">
                  <Input name="driveMiles" type="number" min="0" max="600" step="0.1" inputMode="decimal" />
                </Field>
                <p className="self-end text-xs text-fg-muted">Or compute it automatically on the deal page if Google Routes is configured.</p>
              </>
            ) : null}
          </CardBody>
        </Card>
        <div className="flex justify-end">
          <SubmitButton variant="primary" size="lg" pendingLabel="Importing and evaluating">Import and evaluate</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
