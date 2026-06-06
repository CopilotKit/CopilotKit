"use client";

import { Activity, Sparkles } from "lucide-react";

// Pre-baked prompts surfaced as chips on the empty canvas. Order walks the
// user through the lead-form usecase end-to-end:
//   1. import        (the only thing a fresh canvas can do)
//   2. ranking       (renderDemandSpark inline, or setView('demand'))
//   3. open lead     (selectLead — focuses a specific person)
//   4. draft email   (renderEmailDraft — the agent's outreach surface)
//   5. demand stats  (setView('demand') — the full chart view)
const PROMPTS: Array<{ label: string; prompt: string }> = [
  {
    label: "Import the workshop leads from Notion.",
    prompt: "Import the workshop leads from Notion.",
  },
  {
    label: "What's the most requested workshop?",
    prompt: "What's the most requested workshop?",
  },
  {
    label: "Open Ethan Moore.",
    prompt: "Open Ethan Moore.",
  },
  {
    label: "Draft an email to Ethan.",
    prompt: "Draft an email to Ethan.",
  },
  {
    label: "Show me demand stats.",
    prompt: "Show me demand stats.",
  },
];

const HEALTH_CHECK_PROMPT =
  "Run notion_health_check and tell me the result.";

interface EmptyStateProps {
  onPromptClick?: (prompt: string) => void;
}

export function EmptyState({ onPromptClick }: EmptyStateProps) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card/40 p-12">
      <div className="max-w-xl text-center">
        <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="size-5" />
        </div>
        <h2 className="text-base font-semibold text-foreground">
          No leads loaded yet
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Drive the canvas from the chat panel on the right. The agent will
          read from your connected Notion database and populate this view.
        </p>
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => onPromptClick?.(HEALTH_CHECK_PROMPT)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-accent/40 hover:text-foreground"
          >
            <Activity className="size-3" />
            Ping Notion DB
          </button>
        </div>
        <ul className="mt-4 grid grid-cols-1 gap-2 text-left sm:grid-cols-2">
          {PROMPTS.map((p) => (
            <li key={p.label}>
              <button
                type="button"
                onClick={() => onPromptClick?.(p.prompt)}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-left text-xs text-muted-foreground transition hover:bg-accent/40 hover:text-foreground"
              >
                <span className="text-muted-foreground/60">›</span> {p.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
