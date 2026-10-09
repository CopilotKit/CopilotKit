"use client";

import { ArrowUpRight, Check, Table2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A confirm-before-we-navigate prompt, rendered in the chat.
 *
 * Navigation is the one agent action that moves the user's whole screen out
 * from under them, so it asks first. It also does real work for the demo: the
 * pause makes the human-in-the-loop step legible, and the summary lines tell
 * the officer exactly what the agent is about to set BEFORE the page changes,
 * so the highlighted controls on the Charges page read as "the agent did that"
 * rather than "something moved".
 */
export function NavigateConfirmCard({
  title,
  destination,
  details,
  status,
  onConfirm,
  onCancel,
}: {
  title: string;
  destination: string;
  details: { label: string; value: string }[];
  status: "asking" | "confirmed" | "declined";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (status !== "asking") {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted shadow-soft">
        {status === "confirmed" ? (
          <>
            <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-positive-soft text-positive">
              <Check className="h-3 w-3" aria-hidden />
            </span>
            <span>
              Opened <span className="font-medium text-ink">{destination}</span>
            </span>
          </>
        ) : (
          <span>Stayed on this page.</span>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="chat-navigate-confirm"
      className="pointer-events-auto space-y-3 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-brand-soft text-brand-indigo dark:text-brand-violet">
          <Table2 className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <p className="text-xs leading-relaxed text-ink-muted">
            This opens the{" "}
            <span className="font-medium text-ink">{destination}</span> page and
            sets the controls below for you.
          </p>
        </div>
      </div>

      {details.length > 0 && (
        <dl className="space-y-1 rounded-xl bg-surface-muted/50 px-3 py-2">
          {details.map((detail) => (
            <div
              key={detail.label}
              className="flex items-baseline justify-between gap-3 text-xs"
            >
              <dt className="text-ink-muted">{detail.label}</dt>
              <dd className="truncate font-medium text-ink">{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="chat-navigate-confirm-yes"
          onClick={onConfirm}
          className={cn(
            "brand-gradient inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-surface transition-opacity hover:opacity-90",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
          )}
        >
          Open it
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          data-testid="chat-navigate-confirm-no"
          onClick={onCancel}
          className="rounded-full border border-hairline bg-surface px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-muted"
        >
          Stay here
        </button>
      </div>
    </div>
  );
}

export default NavigateConfirmCard;
