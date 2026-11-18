"use client";

/**
 * BEAT 3c — the rebooking search results.
 *
 * A SEARCH RESULTS LIST, not a worklist. `data/beat-map.md` §
 * "Where the passenger framing genuinely fights the beats", point 1: every
 * other demo-complete skin filters a queue of WORK, and a passenger has no
 * queue. These rows are candidates the traveller may choose between, so the
 * chrome is a flight search's — depart, arrive, duration, stops, cabin, fare,
 * price — and never a queue's "age" or "owner" columns.
 *
 * A `<table>` with real `<th>` headings on purpose: `pages/on-screen-readables
 * .test.tsx` locates the flight column BY HEADING rather than by index, because
 * the board grows a leading rank column whenever a sort lever is active. A fixed
 * index would silently start reading ranks as flight numbers — a test that then
 * compares two lists of "1", "2", "3" and passes.
 */

import { cn } from "@/lib/utils";
import type { FareBrand, RebookingOption } from "../data/trip-types";
import { durationLabel, localClock } from "./local-clock";

/**
 * The fare family as the ticket names it. Kept here rather than derived from
 * the seed so a board row and a trip row say the same words about the same
 * fare — and because beat 4's "never Basic Economy" preference is only visible
 * to the room if "Basic Economy" is on screen in those words.
 */
export const FARE_BRAND_LABELS: Record<FareBrand, string> = {
  basic: "Basic Economy",
  main: "Main Cabin",
  flex: "Flex",
  promo: "Promo Saver",
};

export const CABIN_LABEL: Record<RebookingOption["cabin"], string> = {
  economy: "Economy",
  premium: "Premium",
  business: "Business",
};

export const stopsLabel = (stops: number): string => {
  if (stops <= 0) return "Nonstop";
  if (stops === 1) return "1 stop";
  return `${stops} stops`;
};

/** "+$148", or an em dash when the move costs nothing extra. */
export const fareDifferenceLabel = (usd: number): string =>
  usd > 0 ? `+$${Math.round(usd).toLocaleString("en-US")}` : "—";

export function OptionBoard({
  options,
  showRank = false,
}: {
  options: RebookingOption[];
  /** Numbers the rows. Only meaningful under a sort — the page passes that in. */
  showRank?: boolean;
}) {
  if (options.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-hairline p-6 text-center text-sm text-ink-muted">
        No flights match these filters. Widen the departure window, or allow
        connections.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-hairline bg-surface shadow-soft">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-xs uppercase tracking-wider text-ink-muted">
            {showRank && <th className="px-4 py-3 font-medium">#</th>}
            <th className="px-4 py-3 font-medium">Flight</th>
            <th className="px-4 py-3 font-medium">Depart</th>
            <th className="px-4 py-3 font-medium">Arrive</th>
            <th className="px-4 py-3 font-medium">Duration</th>
            <th className="px-4 py-3 font-medium">Stops</th>
            <th className="px-4 py-3 font-medium">Cabin</th>
            <th className="px-4 py-3 font-medium">Fare</th>
            <th className="px-4 py-3 font-medium">Seats</th>
            <th className="px-4 py-3 text-right font-medium">Difference</th>
          </tr>
        </thead>
        <tbody>
          {options.map((option, i) => (
            <tr
              key={option.id}
              className="border-b border-hairline last:border-0"
            >
              {showRank && (
                <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                  {i + 1}
                </td>
              )}
              <td className="px-4 py-3 font-mono font-semibold text-ink">
                {option.flightNumber}
              </td>
              <td className="px-4 py-3 text-ink">
                {localClock(option.departureLocal) || "—"}
              </td>
              <td className="px-4 py-3 text-ink">
                {localClock(option.arrivalLocal) || "—"}
              </td>
              <td className="px-4 py-3 text-ink-muted">
                {durationLabel(option.durationMinutes) || "—"}
              </td>
              <td className="px-4 py-3 text-ink-muted">
                {stopsLabel(option.stops)}
              </td>
              <td className="px-4 py-3 text-ink-muted">
                {CABIN_LABEL[option.cabin]}
              </td>
              <td className="px-4 py-3 text-ink-muted">
                {FARE_BRAND_LABELS[option.fareBrand]}
              </td>
              <td className="px-4 py-3 text-ink-muted">
                {option.seatsAvailable}
              </td>
              <td
                className={cn(
                  "px-4 py-3 text-right font-mono",
                  option.fareDifferenceUsd > 0 ? "text-ink" : "text-positive",
                )}
              >
                {fareDifferenceLabel(option.fareDifferenceUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
