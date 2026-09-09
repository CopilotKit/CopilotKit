import type { Lane, Shipment } from "./types";

/**
 * BEAT 4 — the SELECTION behind the recalled exception summary.
 *
 * Pure and separate from the component for the same reason commerce split
 * `selectSummaryRows` out of `MarginSummaryList`: the grouping and the ordering
 * are what the recalled preference actually CHANGES, so they are the part that
 * has to be testable without a provider stack. If a stated preference did not
 * visibly move a row, the beat is a claim the audience has to take on faith.
 *
 * Three independent behaviours, one per flag, because a single-clause preference
 * reads as a coincidence from the back of a room:
 *
 *  - `byLane`         — group by LANE rather than by carrier.
 *  - `breachFirst`    — shipments already past their promised date come first,
 *                       both within a group and between groups.
 *  - `roundThousands` — exposure as whole thousands rather than to the dollar.
 */

export interface ExceptionSummaryRow {
  reference: string;
  status: Shipment["status"];
  exception: string;
  /** Current ETA is past the date promised to the customer. */
  breached: boolean;
  valueUsd: number;
  daysLate: number;
}

export interface ExceptionSummaryGroup {
  /** The lane's "Origin → Destination (mode)", or the carrier's name. */
  label: string;
  rows: ExceptionSummaryRow[];
  exposureUsd: number;
  breachCount: number;
}

export interface ExceptionSummaryOptions {
  byLane: boolean;
  breachFirst: boolean;
}

const DAY_MS = 86_400_000;

const breaches = (s: Shipment) =>
  Date.parse(s.etaCurrent) > Date.parse(s.slaDate);

const laneLabel = (lane: Lane) =>
  `${lane.origin} → ${lane.destination} (${lane.mode})`;

/**
 * Group the exception queue for the summary.
 *
 * Takes ALL shipments and filters to the ones carrying an exception here rather
 * than at the call site, so the summary and the Control Tower board can never
 * disagree about what "the queue" is.
 */
export function summarizeExceptions(
  shipments: Shipment[],
  lanes: Lane[],
  { byLane, breachFirst }: ExceptionSummaryOptions,
): ExceptionSummaryGroup[] {
  const laneById = new Map(lanes.map((l) => [l.id, l]));
  const queue = shipments.filter((s) => s.exception);
  const groups = new Map<string, ExceptionSummaryGroup>();

  for (const s of queue) {
    const lane = laneById.get(s.laneId);
    const label = byLane ? (lane ? laneLabel(lane) : s.laneId) : s.carrier;
    const breached = breaches(s);
    const row: ExceptionSummaryRow = {
      reference: s.reference,
      status: s.status,
      // `exception` is present by construction — `queue` filtered on it — but
      // the type still says optional, and a `!` here would be a lie the moment
      // someone changes that filter.
      exception: s.exception?.code ?? "—",
      breached,
      valueUsd: s.valueUsd,
      daysLate: Math.round(
        (Date.parse(s.etaCurrent) - Date.parse(s.slaDate)) / DAY_MS,
      ),
    };
    const group = groups.get(label) ?? {
      label,
      rows: [],
      exposureUsd: 0,
      breachCount: 0,
    };
    group.rows.push(row);
    group.exposureUsd += s.valueUsd;
    if (breached) group.breachCount += 1;
    groups.set(label, group);
  }

  for (const group of groups.values()) {
    // Biggest exposure first is the base order in BOTH modes, so the only thing
    // the preference changes is whether breaches float — which is what makes
    // toggling it visible rather than merely different.
    group.rows.sort((a, b) => b.valueUsd - a.valueUsd);
    if (breachFirst) {
      group.rows.sort((a, b) => Number(b.breached) - Number(a.breached));
    }
  }

  const ordered = [...groups.values()].sort(
    (a, b) => b.exposureUsd - a.exposureUsd,
  );
  if (breachFirst) {
    ordered.sort(
      (a, b) => Number(b.breachCount > 0) - Number(a.breachCount > 0),
    );
  }
  return ordered;
}

/**
 * Exposure as the recalled preference wants it read.
 *
 * `$240k` vs `$240,000` — a deliberately unmistakable difference, because this
 * string is the one the room can check against the KPI strip while the presenter
 * is still saying "I never told it that in this session".
 */
export const formatExposure = (usd: number, roundThousands: boolean): string =>
  roundThousands
    ? `$${Math.round(usd / 1000).toLocaleString("en-US")}k`
    : `$${Math.round(usd).toLocaleString("en-US")}`;
