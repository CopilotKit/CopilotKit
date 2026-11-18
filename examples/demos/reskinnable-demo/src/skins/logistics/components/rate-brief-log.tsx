"use client";

import type { RateBrief, RateBriefLane } from "../data/types";

/**
 * BEAT 3d — the durable artifact, on screen.
 *
 * This is the half of the beat the room grades: the brief is a record of the
 * APPLICATION, so deleting the whole thread that produced it leaves this list
 * exactly as it was. Nothing here reads a thread, a run or a message.
 */

const rate = (usd: number) => `$${usd.toFixed(2)}`;

/**
 * The movement a row shows, computed HERE from the two rates rather than stored.
 *
 * A row with no prior rate is not "up from nothing" — it is the lane the network
 * has never carried, which is the row that proves the document was read. It says
 * so instead of showing a percentage it cannot compute.
 */
function movementOf(row: RateBriefLane): { label: string; tone: string } {
  if (typeof row.oldRateUsdPerKg !== "number" || row.oldRateUsdPerKg <= 0) {
    return { label: "new lane", tone: "text-brand" };
  }
  const delta = row.newRateUsdPerKg - row.oldRateUsdPerKg;
  if (delta === 0) return { label: "flat", tone: "text-ink-muted" };
  const pct = Math.abs((delta / row.oldRateUsdPerKg) * 100).toFixed(1);
  return delta > 0
    ? { label: `up ${pct}%`, tone: "text-negative" }
    : { label: `down ${pct}%`, tone: "text-positive" };
}

/** Newest first, matching the Decision Log beside it. Exported so the page's
 *  beat-3b readable and this list share ONE ordering. */
export function orderRateBriefRows(briefs: RateBrief[]): RateBrief[] {
  return [...briefs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function RateBriefLog({ briefs }: { briefs: RateBrief[] }) {
  if (!briefs.length) {
    return (
      <p className="text-sm text-ink-muted">
        No carrier rate sheets ingested yet.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {orderRateBriefRows(briefs).map((brief) => (
        <li
          key={brief.id}
          className="rounded-lg border border-hairline bg-surface p-4 shadow-soft"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium text-ink">{brief.carrier}</span>
            <span className="text-xs text-ink-muted">
              Rates effective {brief.effective}
            </span>
          </div>
          <p className="mt-2 text-sm text-ink">{brief.summary}</p>

          {brief.laneRates.length ? (
            <ul className="mt-3 space-y-1">
              {brief.laneRates.map((row) => {
                const movement = movementOf(row);
                return (
                  <li
                    key={`${row.lane}-${row.mode}`}
                    className="flex flex-wrap items-baseline gap-2 text-sm"
                  >
                    <span className="font-mono text-ink">{row.lane}</span>
                    <span className="text-xs capitalize text-ink-muted">
                      {row.mode}
                    </span>
                    <span className="tabular-nums text-ink-muted">
                      {typeof row.oldRateUsdPerKg === "number"
                        ? `${rate(row.oldRateUsdPerKg)} → ${rate(row.newRateUsdPerKg)}`
                        : `${rate(row.newRateUsdPerKg)}`}
                      <span className="ml-1 text-xs">/kg</span>
                    </span>
                    <span className={`text-xs font-medium ${movement.tone}`}>
                      {movement.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {brief.impacts.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-ink-muted">
              {brief.impacts.map((impact) => (
                <li key={impact}>{impact}</li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 text-xs text-ink-muted">
            {brief.filedBy} · {brief.role}
          </div>
        </li>
      ))}
    </ul>
  );
}
