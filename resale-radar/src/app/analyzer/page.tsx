import { Calculator } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { asOwner } from "@/server/auth";
import { getBuyingPower, getSettings } from "@/server/services/core";
import { AnalyzerForm } from "./analyzer-form";

export const metadata = { title: "Deal Analyzer" };
export const dynamic = "force-dynamic";

export default async function AnalyzerPage() {
  const { settings, buyingPower } = await asOwner(async (q, o) => {
    const { settings } = await getSettings(q, o);
    const bp = await getBuyingPower(q, o, settings);
    return { settings, buyingPower: bp.summary.contributedCents > 0 ? bp.availableCents : null };
  });
  return (
    <div className="animate-in">
      <PageHeader
        icon={<Calculator />}
        title="Deal Analyzer"
        description="Quick what-if math with the same deterministic engine used for every deal. Nothing is saved. Import the listing to track it."
      />
      <AnalyzerForm settings={settings} buyingPowerCents={buyingPower} />
    </div>
  );
}
