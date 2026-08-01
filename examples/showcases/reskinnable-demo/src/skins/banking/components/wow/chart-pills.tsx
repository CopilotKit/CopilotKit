"use client";

import { Sparkles } from "lucide-react";
import { useAskCopilot } from "./use-ask-copilot";

export interface ChartPill {
  /** Short label shown on the pill. */
  label: string;
  /** Full message sent to the copilot when the pill is clicked. */
  message: string;
}

/**
 * "Talk to what you see": wraps a dashboard chart in a card that carries its
 * own conversation starters. Each pill sends a preset, chart-specific prompt
 * to the copilot — the agent already sees the full dataset via the global
 * useAgentContext readables, so the answer is grounded in exactly the data
 * the chart renders, and its gen-UI drill-down components (showBudgetUsage
 * etc.) give the visual follow-up in chat.
 */
export function ChartCard({
  title,
  pills,
  children,
}: {
  title: string;
  pills: ChartPill[];
  children: React.ReactNode;
}) {
  const askCopilot = useAskCopilot();

  return (
    <section
      data-testid={`chart-card-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-soft"
    >
      <h3 className="section-heading text-base">{title}</h3>
      <div className="flex-1">{children}</div>
      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
        <Sparkles
          className="h-3.5 w-3.5 shrink-0 text-brand-indigo dark:text-brand-violet"
          aria-hidden
        />
        {pills.map((pill) => (
          <button
            key={pill.label}
            type="button"
            onClick={() => askCopilot(pill.message)}
            className="rounded-full border border-hairline bg-brand-soft/60 px-3 py-1 text-xs font-medium text-brand-indigo transition-colors hover:bg-brand-soft dark:text-brand-violet"
          >
            {pill.label}
          </button>
        ))}
      </div>
    </section>
  );
}

export default ChartCard;
