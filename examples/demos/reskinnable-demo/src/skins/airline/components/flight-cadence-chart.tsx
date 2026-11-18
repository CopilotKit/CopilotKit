"use client";

/**
 * BEAT 1 — "How often do I fly?", answered as a cadence strip.
 *
 * Every trip on the account laid out on a day scale, with a TODAY divider and
 * the disrupted ones called out. It is the first thing the demo renders, so it
 * carries the whole "generative UI, right out of the gate" claim: the answer
 * arrives as a picture, not as a paragraph.
 *
 * WHY A STRIP AND NOT BARS. The account holds seven trips across about ten
 * weeks. Monthly bars collapse that to three columns, hide which trips are
 * disrupted, and read as a stub on a projector. The strip uses all seven, and
 * the GAPS between the markers are the actual answer to "how often" — which is
 * also why the summary quotes the average gap rather than a count.
 *
 * ⚠️ ALL POSITIONING ARITHMETIC LIVES IN `data/flight-cadence.ts`. This file
 * receives `position` already normalised to 0..1 and does nothing but paint.
 * That split is deliberate: date maths in a component is date maths nothing can
 * unit-test, and this app has already been bitten twice by timestamps being
 * re-expressed in whatever timezone the process happened to run in.
 *
 * ⚠️ NO `Date` ANYWHERE IN THIS FILE, and none in the helper either. The app
 * runs on a fixed demo clock (`SEED_NOW`), so a component that reached for the
 * real date would draw a divider the server never rendered and disagree with
 * its own summary line.
 */

import { cn } from "@/lib/utils";
import type { CadenceMarker, FlightCadence } from "../data/flight-cadence";
import { localDate } from "./local-clock";

/**
 * Marker tones, matching `trip-list.tsx`'s `TONE_CLASS` so a cancelled trip
 * reads the same colour here as it does on the trips page. There is NO `warn`
 * design token — the vocabulary is brand / positive / negative (each with a
 * `-soft`) — and airline already spends raw Tailwind amber for the middle
 * state, so this follows rather than inventing a token the theme cannot value.
 */
const TONE: Record<string, string> = {
  cancelled: "bg-negative border-negative",
  delayed: "bg-amber-400 border-amber-500",
  ok: "bg-brand border-brand",
};

function toneOf(marker: CadenceMarker): string {
  return TONE[marker.disruption ?? "ok"] ?? TONE.ok!;
}

/** The summary sentence, so the figures and the picture cannot disagree. */
export function cadenceSummary(cadence: FlightCadence): string {
  if (!cadence.markers.length) return "No trips on the account.";
  const trips = `${cadence.markers.length} ${cadence.markers.length === 1 ? "trip" : "trips"}`;
  const gap =
    cadence.averageGapDays === null
      ? null
      : `about every ${cadence.averageGapDays} days`;
  const disrupted = cadence.disrupted
    ? `${cadence.disrupted} disrupted`
    : "none disrupted";
  return [trips, gap, disrupted].filter(Boolean).join(" · ");
}

export function FlightCadenceChart({
  cadence,
  note,
}: {
  cadence: FlightCadence;
  /** The remembered preference the agent applied, when it recalled one. */
  note?: string | null;
}) {
  if (!cadence.markers.length) {
    // An empty strip drawn with confidence is worse than saying so.
    return (
      <div
        data-testid="flight-cadence-empty"
        className="rounded-[--radius] border border-hairline bg-surface p-4 text-sm text-ink/70"
      >
        No trips on this account in the next few months.
      </div>
    );
  }

  return (
    <div
      data-testid="flight-cadence"
      className="rounded-[--radius] border border-hairline bg-surface p-4"
    >
      {note ? (
        <p
          data-testid="flight-cadence-note"
          className="mb-3 rounded-[--radius] border border-brand/30 bg-brand-soft px-3 py-2 text-xs text-ink/80"
        >
          {note}
        </p>
      ) : null}

      {/* The rail. `position` is 0..1 from the helper; nothing is computed here. */}
      <div className="relative mt-6 mb-8 h-px w-full bg-hairline">
        {/* TODAY. Drawn from the helper's own window, never from a live clock. */}
        <div
          data-testid="flight-cadence-today"
          className="absolute -top-5 bottom-[-1.25rem] w-px bg-ink/40"
          style={{ left: "50%" }}
        >
          <span className="absolute -top-5 left-1 text-[10px] uppercase tracking-wide text-ink/50">
            today
          </span>
        </div>

        {cadence.months.map((month) => (
          <span
            key={`${month.label}-${month.position}`}
            className="absolute -top-5 -translate-x-1/2 text-[10px] uppercase tracking-wide text-ink/40"
            style={{ left: `${month.position * 100}%` }}
          >
            {month.label}
          </span>
        ))}

        {cadence.markers.map((marker) => (
          <div
            key={marker.flightId}
            data-testid={`cadence-marker-${marker.flightNumber}`}
            className="absolute -translate-x-1/2"
            style={{ left: `${marker.position * 100}%`, top: "-0.3125rem" }}
          >
            <span
              className={cn(
                "block h-2.5 w-2.5 rounded-full border",
                toneOf(marker),
                marker.flown && "opacity-50",
              )}
              title={`${marker.flightNumber} → ${marker.destinationCity}`}
            />
            <span className="absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap text-[10px] text-ink/60">
              {marker.destination}
            </span>
          </div>
        ))}
      </div>

      <ul className="mt-8 space-y-1 text-xs text-ink/70">
        {cadence.markers
          .filter((marker) => marker.disruption)
          .map((marker) => (
            <li key={marker.flightId} data-testid="cadence-disruption">
              <span
                className={cn(
                  "font-medium",
                  marker.disruption === "cancelled"
                    ? "text-negative"
                    : "text-amber-700",
                )}
              >
                {marker.disruption === "cancelled" ? "Cancelled" : "Delayed"}
              </span>{" "}
              — {marker.flightNumber} to {marker.destinationCity} on{" "}
              {localDate(`${marker.date}T00:00`)}
            </li>
          ))}
      </ul>

      <p
        data-testid="flight-cadence-summary"
        className="mt-3 border-t border-hairline pt-3 text-sm font-medium text-ink"
      >
        {cadenceSummary(cadence)}
      </p>
    </div>
  );
}
