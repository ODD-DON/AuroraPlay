import { Import } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { aiConfigured } from "@/integrations/ai";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import listing" };

type SP = Record<string, string | string[] | undefined>;

/** Also the PWA share target: shared URLs and text arrive as query parameters. */
export default async function ImportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const pick = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined)) ?? "";
  const sharedText = pick("text");
  const urlInText = sharedText.match(/https?:\/\/\S+/)?.[0] ?? "";
  return (
    <div className="mx-auto max-w-3xl animate-in">
      <PageHeader
        icon={<Import />}
        title="Import a listing"
        description="Paste a link, share from the Facebook or eBay app, or upload a screenshot. Every import gets a full evaluation."
      />
      <ImportForm aiAvailable={aiConfigured()} initialUrl={pick("url") || urlInText} initialTitle={pick("title") || (urlInText ? sharedText.replace(urlInText, "").trim() : sharedText)} />
    </div>
  );
}
