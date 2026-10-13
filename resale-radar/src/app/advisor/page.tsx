import { Bot } from "lucide-react";
import { Notice, PageHeader } from "@/components/ui";
import { aiConfigured } from "@/integrations/ai";
import { AdvisorChat } from "./chat";

export const metadata = { title: "AI Advisor" };

export default function AdvisorPage() {
  return (
    <div className="mx-auto max-w-3xl animate-in">
      <PageHeader icon={<Bot />} title="AI Advisor" description="Ask about your deals, inventory, and finances. Answers come from your records through read-only tools; all math is done by the calculation engine." />
      {aiConfigured() ? (
        <AdvisorChat />
      ) : (
        <Notice tone="caution" title="The AI Advisor needs an Anthropic API key">
          Add ANTHROPIC_API_KEY to the server environment (see Settings, Integrations). Every other screen works without it.
        </Notice>
      )}
    </div>
  );
}
