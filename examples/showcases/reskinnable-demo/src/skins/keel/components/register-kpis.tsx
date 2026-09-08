"use client";

import { deriveRegisterKpis } from "@/skins/keel/data/register-summary";
import { coverageCaveat } from "@/skins/keel/data/attention";
import type { DocumentRecord } from "@/skins/keel/data/types";

/**
 * The four register-health tiles, and the ONE derivation behind them.
 *
 * `deriveRegisterKpiTiles` is exported so the strip below and the page's beat-3b
 * readable read the SAME function rather than each formatting the same figures.
 * Logistics learned this the small way: its strip rounds a ratio to "67%" for
 * display, and a readable holding the raw 0.6666… got quoted back on stage as
 * "66.7%". A one-decimal drift is the same KIND of error as a row-count drift,
 * so both sides read one function and the tiles are DISPLAY STRINGS, never raw
 * numbers.
 *
 * The coverage tile is the interesting one: it prints "Not measured" rather than
 * "0%" when nothing in the set is measurable, and carries the caveat sentence
 * beside the strip whenever any row is unmeasurable — both off the same
 * tri-state `data/attention.ts` models, so the figure and its caveat cannot
 * disagree.
 */

export interface RegisterKpiTile {
  label: string;
  value: string;
}

export function deriveRegisterKpiTiles(
  records: DocumentRecord[],
  now: number,
): RegisterKpiTile[] {
  const kpis = deriveRegisterKpis(records, now);
  return [
    { label: "Documents in force", value: String(kpis.inForce) },
    { label: "Past review date", value: String(kpis.pastReview) },
    {
      label: "Attestation coverage",
      value:
        kpis.coveragePercent === null
          ? "Not measured"
          : `${kpis.coveragePercent}%`,
    },
    {
      label: "Awaiting release",
      value: String(kpis.awaitingRelease),
    },
  ];
}

export function RegisterKpiStrip({
  records,
  now,
}: {
  records: DocumentRecord[];
  now: number;
}) {
  const tiles = deriveRegisterKpiTiles(records, now);
  const caveat = coverageCaveat(
    deriveRegisterKpis(records, now).coverageUnknown,
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-lg border border-hairline bg-surface p-4 shadow-soft"
          >
            <div className="text-2xl font-bold tabular-nums text-ink">
              {tile.value}
            </div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
              {tile.label}
            </div>
          </div>
        ))}
      </div>
      {caveat && <p className="text-xs italic text-ink-muted">{caveat}</p>}
    </div>
  );
}

export default RegisterKpiStrip;
