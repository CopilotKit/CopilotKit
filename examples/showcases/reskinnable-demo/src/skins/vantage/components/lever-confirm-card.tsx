"use client";

import { Compass } from "lucide-react";

/**
 * Beat 3c's confirm step. It names every lever BEFORE the screen changes, so the
 * audience sees a deliberate maneuver rather than a link being followed.
 */
export function LeverConfirmCard({
  status,
  levers,
  destination,
  onConfirm,
  onCancel,
}: {
  status: "asking" | "confirmed" | "declined";
  levers: { label: string; value: string }[];
  destination: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (status !== "asking") {
    return (
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-[var(--radius)] border border-hairline bg-surface p-3.5 text-sm">
        <Compass
          className={
            status === "confirmed"
              ? "h-4 w-4 text-brand"
              : "h-4 w-4 text-ink-muted"
          }
        />
        <span className="text-ink">
          {status === "confirmed"
            ? `Opened ${destination} with those levers applied.`
            : "Stayed on this page."}
        </span>
      </div>
    );
  }
  return (
    <div className="pointer-events-auto space-y-3 rounded-[var(--radius)] border border-hairline bg-surface p-4">
      <div className="flex items-center gap-2">
        <Compass className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-semibold text-ink">
          Open {destination} with these levers?
        </h3>
      </div>
      <dl className="grid gap-1.5">
        {levers.map((lever) => (
          <div
            key={lever.label}
            className="flex items-baseline justify-between gap-3"
          >
            <dt className="text-[11px] uppercase tracking-wide text-ink-muted">
              {lever.label}
            </dt>
            <dd className="text-xs font-semibold text-ink">{lever.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-[var(--radius)] bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground"
        >
          Open it
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--radius)] border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
        >
          Stay here
        </button>
      </div>
    </div>
  );
}
