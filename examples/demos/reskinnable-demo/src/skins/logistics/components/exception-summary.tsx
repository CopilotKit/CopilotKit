"use client";

import { BrainCircuit } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatExposure, summarizeExceptions } from "../data/exception-summary";
import type { Lane, Shipment } from "../data/types";

/**
 * BEAT 4 — the recalled exception summary, and the SLOT FOR THE "WHY".
 *
 * The band at the top is the whole beat. Banking learned this on
 * `showSpendSummary`: an agent that silently obeys a recalled preference
 * produces an answer the audience cannot distinguish from a normal one, so the
 * memory does all the work and gets none of the credit. `note` is where the
 * agent names, in its own words, the preference it just applied — and it is
 * rendered as a distinct, marked band rather than as a line of body copy, so
 * from the back of a room it reads as "it remembered" before anyone has read a
 * word of it.
 *
 * Every prop is OPTIONAL even though the tool schema declares them required.
 * The render is handed STREAMING arguments, so this component really is called
 * with `undefined` in every slot on the way to the real values — commerce's
 * equivalent typed them required and got an empty band on the first frame.
 */
export function ExceptionSummaryList({
  shipments,
  lanes,
  byLane,
  breachFirst,
  roundThousands,
  note,
}: {
  shipments: Shipment[];
  lanes: Lane[];
  byLane?: boolean;
  breachFirst?: boolean;
  roundThousands?: boolean;
  note?: string;
}) {
  const groups = summarizeExceptions(shipments, lanes, {
    byLane: byLane ?? true,
    breachFirst: breachFirst ?? true,
  });

  if (!groups.length) {
    return (
      <p className="text-sm text-ink-muted">No exceptions on the board.</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The "why". Rendered only when the agent actually filled it — an empty
          band would assert a recall that did not happen, which is worse on
          stage than no band at all. */}
      {note ? (
        <div className="flex items-start gap-2 rounded-lg border border-brand/40 bg-brand-soft px-3 py-2 text-xs text-brand-indigo dark:text-brand-violet">
          <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="font-medium">{note}</span>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-hairline bg-surface shadow-soft">
        {groups.map((group) => (
          <section
            key={group.label}
            className="border-b border-hairline last:border-0"
          >
            <header className="flex items-baseline justify-between gap-3 bg-surface-muted px-3 py-2">
              <span className="text-sm font-semibold text-ink">
                {group.label}
              </span>
              <span className="tabular-nums text-xs text-ink-muted">
                {formatExposure(group.exposureUsd, roundThousands ?? true)}{" "}
                exposed
                {group.breachCount > 0 ? (
                  <span className="ml-2 rounded-md bg-negative-soft px-1.5 py-0.5 font-medium text-negative">
                    {group.breachCount} past promise
                  </span>
                ) : null}
              </span>
            </header>
            <ul>
              {group.rows.map((row) => (
                <li
                  key={row.reference}
                  className="flex items-baseline justify-between gap-3 border-t border-hairline px-3 py-2 text-sm first:border-0"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="font-medium text-ink">
                      {row.reference}
                    </span>
                    <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-xs text-ink-muted">
                      {row.exception}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "tabular-nums text-xs",
                      row.breached ? "text-negative" : "text-ink-muted",
                    )}
                  >
                    {formatExposure(row.valueUsd, roundThousands ?? true)}
                    {row.breached ? ` · ${row.daysLate}d past promise` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
