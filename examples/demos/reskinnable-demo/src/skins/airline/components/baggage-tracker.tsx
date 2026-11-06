"use client";

import { Luggage } from "lucide-react";
import type { BaggageItem } from "../data/types";
import { relativeTime, cn } from "./utils";

interface BaggageTrackerProps {
  baggage: BaggageItem[];
}

const STEPS: Array<{ key: BaggageItem["status"]; label: string }> = [
  { key: "checked", label: "Checked" },
  { key: "in_transit", label: "In transit" },
  { key: "loaded", label: "Loaded" },
  { key: "arrived", label: "Arrived" },
  { key: "claimed", label: "Claimed" },
];

function stepIndex(status: BaggageItem["status"]): number {
  if (status === "delayed") return -1;
  return STEPS.findIndex((s) => s.key === status);
}

export function BaggageTracker({ baggage }: BaggageTrackerProps) {
  if (baggage.length === 0) return null;
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-5 shadow-soft">
      <div className="mb-4 text-xs uppercase tracking-wider text-ink-muted">
        Baggage
      </div>
      <div className="flex flex-col gap-5">
        {baggage.map((item) => {
          const current = stepIndex(item.status);
          const isDelayed = item.status === "delayed";
          return (
            <div key={item.tag_id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-muted text-ink">
                    <Luggage className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-semibold text-ink">
                      {item.tag_id}
                    </div>
                    <div className="truncate text-xs text-ink-muted">
                      {item.description}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-muted">
                      {item.last_location} · {relativeTime(item.last_updated)}
                    </div>
                  </div>
                </div>
                {isDelayed ? (
                  <span className="rounded-full bg-negative-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-negative">
                    Delayed
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-1">
                {STEPS.map((step, i) => {
                  const done = !isDelayed && i <= current;
                  const active = !isDelayed && i === current;
                  return (
                    <div
                      key={step.key}
                      className="flex flex-1 items-center gap-1"
                    >
                      <div
                        className={cn(
                          "h-2 flex-1 rounded-full transition-colors",
                          done ? "bg-brand" : "bg-hairline",
                          active && "ring-2 ring-brand/40",
                        )}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] uppercase tracking-wider text-ink-muted">
                {STEPS.map((s, i) => (
                  <span
                    key={s.key}
                    className={cn(
                      i === current && !isDelayed && "font-semibold text-brand",
                    )}
                  >
                    {s.label}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
