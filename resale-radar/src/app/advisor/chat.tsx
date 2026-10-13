"use client";

import { ArrowUp, Loader2, Wrench } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { askAdvisorAction } from "@/app/actions";
import { Button, Card, cn } from "@/components/ui";

const SUGGESTIONS = [
  "What's the best deal within 20 minutes?",
  "Anything worth driving 45 minutes for?",
  "Can I afford my top three deals?",
  "Which item is tying up my capital?",
  "How much actual profit did I make last month?",
  "How close am I to $30,000?",
];

type Msg = { role: "user" | "assistant"; content: string; tools?: string[] };

export function AdvisorChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    setError(null);
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    start(async () => {
      const r = await askAdvisorAction(q, history);
      if (!r.ok) {
        setError(r.error ?? "The advisor could not answer.");
        return;
      }
      const data = r.data as { answer: string; toolCalls: { name: string }[] };
      setMessages((m) => [...m, { role: "assistant", content: data.answer, tools: [...new Set(data.toolCalls.map((t) => t.name))] }]);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    });
  };

  return (
    <Card className="flex flex-col">
      <div className="flex min-h-[320px] flex-col gap-3 p-4 sm:p-5">
        {messages.length === 0 ? (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => ask(s)} className="rounded-full border border-border px-3 py-1.5 text-left text-xs text-fg-muted hover:border-border-strong hover:text-fg">
                {s}
              </button>
            ))}
          </div>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={cn("max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm", m.role === "user" ? "self-end bg-accent-soft" : "self-start border border-border bg-surface-2")}>
            <p className="whitespace-pre-line leading-relaxed">{m.content}</p>
            {m.tools?.length ? (
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-fg-subtle"><Wrench className="size-3" /> Checked: {m.tools.join(", ").replace(/_/g, " ")}</p>
            ) : null}
          </div>
        ))}
        {pending ? <p className="flex items-center gap-2 text-xs text-fg-muted"><Loader2 className="size-3.5 animate-spin" /> Checking your records</p> : null}
        {error ? <p role="alert" className="text-xs text-negative">{error}</p> : null}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex items-end gap-2 border-t border-border p-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Ask about deals, inventory, or profit"
          aria-label="Question"
          className="max-h-40 min-h-9 flex-1 resize-none rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm placeholder:text-fg-subtle focus:border-accent focus:outline-none"
        />
        <Button type="submit" variant="primary" size="icon" disabled={pending || !input.trim()} aria-label="Send"><ArrowUp /></Button>
      </form>
    </Card>
  );
}
