"use client";

/**
 * Tiny inline horizontal-bar showing the top-3 workshops by lead count.
 * Used when the agent answers "what's hot" / "rank workshops" without
 * needing to switch the canvas view.
 *
 * The component computes its own top-3 from `leads`, so the agent can
 * call `renderDemandSpark({})` with zero args and still get a useful
 * inline answer.
 */

import { motion } from "motion/react";
import type { Lead } from "@/lib/leads/types";
import { workshopDemand } from "@/lib/leads/derive";

const WORKSHOP_BAR: Record<string, string> = {
  "Agentic UI (AG-UI)": "bg-violet-500",
  "MCP Apps / Tooling": "bg-sky-500",
  "RAG & Data Chat": "bg-emerald-500",
  "Evaluations & Guardrails": "bg-amber-500",
  "Deploying Agents (prod)": "bg-indigo-500",
  "Not sure yet": "bg-slate-400",
};

export interface DemandSparkProps {
  /** Leads from agent state. The agent passes nothing — this is rendered with
   *  the leads already on the canvas, supplied by the page render slot. */
  leads?: Lead[];
  /** Optional override for ranking (e.g. show top-N tools instead). Falls back
   *  to top-3 workshops. */
  rows?: { label: string; count: number }[];
  /** Optional title — defaults to "Top workshops". */
  title?: string;
}

export function DemandSpark({ leads, rows, title }: DemandSparkProps) {
  const computed =
    rows ??
    (leads ? workshopDemand(leads).slice(0, 3) : ([] as { label: string; count: number }[]));

  // workshopDemand returns one row per workshop with count=0 even when leads
  // is empty, so "no rows" alone isn't enough to detect "no data" — also
  // catch the all-zeros case (which is what the user sees pre-import).
  const total = computed.reduce((sum, r) => sum + r.count, 0);
  if (computed.length === 0 || total === 0) {
    return (
      <div className="my-2 max-w-[320px] rounded-xl border border-dashed border-border bg-card/60 p-3 text-[11px] text-muted-foreground">
        No leads loaded yet — ask me to import them first.
      </div>
    );
  }

  const max = Math.max(1, ...computed.map((r) => r.count));

  return (
    <div className="my-2 max-w-[320px] rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title ?? "Top workshops"}
      </div>
      <ul className="flex flex-col gap-1.5">
        {computed.map((r) => {
          const pct = (r.count / max) * 100;
          const barClass = WORKSHOP_BAR[r.label] ?? "bg-primary/70";
          return (
            <li
              key={r.label}
              className="grid grid-cols-[110px_1fr_24px] items-center gap-2"
            >
              <span className="truncate text-[11px] text-muted-foreground">
                {r.label}
              </span>
              <span className="relative h-2 overflow-hidden rounded bg-muted">
                <motion.span
                  className={`absolute inset-y-0 left-0 rounded ${barClass}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
              </span>
              <span className="text-right text-[11px] font-medium tabular-nums text-foreground">
                {r.count}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
