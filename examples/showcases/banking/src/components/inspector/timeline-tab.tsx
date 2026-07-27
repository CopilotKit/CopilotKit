"use client";

import { useEffect, useRef } from "react";
import { useInspector } from "@/lib/inspector/store";
import type { StoredCard } from "@/lib/inspector/store";

const KIND_DOT: Record<StoredCard["kind"], string> = {
  lifecycle: "bg-ink-muted",
  error: "bg-negative",
  "tool-call": "bg-brand-indigo",
  "tool-result": "bg-brand-violet/60",
  state: "bg-brand-violet",
  "hitl-gate": "bg-amber-500",
  custom: "bg-ink-muted",
  memory: "bg-positive",
};

export function TimelineTab() {
  const { cards } = useInspector();
  // Auto-scroll to the newest card as events stream in, so the timeline reads
  // as a live feed during the demo.
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [cards.length]);

  if (cards.length === 0) {
    return (
      <p className="p-4 text-sm text-ink-muted">
        Send a message — every AG-UI protocol event the run emits appears here,
        live.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-2 p-3">
      {cards.map((c) => (
        <li key={c.id} className="rounded-xl border border-hairline p-2">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${KIND_DOT[c.kind]}`}
            />
            <span className="text-xs font-medium text-ink">{c.title}</span>
          </div>
          {c.summary && (
            <p className="mt-1 text-[11px] text-ink-muted">{c.summary}</p>
          )}
          <details className="mt-1">
            <summary className="cursor-pointer text-[10px] text-ink-muted">
              raw event
            </summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-surface-muted p-2 text-[10px] leading-relaxed text-ink">
              {JSON.stringify(c.raw, null, 2)}
            </pre>
          </details>
        </li>
      ))}
      <div ref={endRef} aria-hidden />
    </ol>
  );
}
