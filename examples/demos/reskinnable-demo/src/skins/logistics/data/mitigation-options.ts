import type { Lane, MitigationKind, MitigationOption, Shipment } from "./types";

/** Flat re-documentation fee for switching a shipment onto another lane. */
const REROUTE_FEE_USD = 250;
/** Flat handling fee for splitting a shipment across two lanes. */
const SPLIT_HANDLING_USD = 150;

/** Shift an ISO date (YYYY-MM-DD) by whole days. UTC-based so it is stable
 *  regardless of the machine's timezone — no wall-clock reads. */
function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const usable = (lane: Lane) => lane.status !== "blocked";

/** The fastest usable air lane serving this shipment's destination. */
function airLaneFor(
  shipment: Shipment,
  lanes: Lane[],
  current: Lane,
): Lane | undefined {
  return lanes
    .filter(
      (l) =>
        l.mode === "air" && l.destination === current.destination && usable(l),
    )
    .sort((a, b) => a.transitDays - b.transitDays)[0];
}

/** The fastest usable NON-air alternate lane to the same destination. */
function altLaneFor(
  shipment: Shipment,
  lanes: Lane[],
  current: Lane,
): Lane | undefined {
  return lanes
    .filter(
      (l) =>
        l.id !== current.id &&
        l.mode !== "air" &&
        l.destination === current.destination &&
        usable(l),
    )
    .sort((a, b) => a.transitDays - b.transitDays)[0];
}

const daysSaved = (current: Lane, replacement: Lane) =>
  Math.max(0, current.transitDays - replacement.transitDays);

/**
 * Compute the mitigation options available for a shipment. Pure and
 * deterministic: every ETA derives from the shipment's own `etaCurrent` and
 * lane transit deltas, never from the wall clock, so tests are stable.
 *
 * The SERVER calls this to recompute cost on every mitigate request — a
 * client-supplied cost is never trusted, or the authority gate would be
 * theater.
 */
export function computeMitigationOptions(
  shipment: Shipment,
  lanes: Lane[],
): MitigationOption[] {
  const current = lanes.find((l) => l.id === shipment.laneId);
  if (!current) return [];

  const options: MitigationOption[] = [];
  const meets = (etaDate: string) => etaDate <= shipment.slaDate;

  // absorb — always available.
  const absorbMet = meets(shipment.etaCurrent);
  options.push({
    kind: "absorb",
    label: "Absorb the delay",
    costUsd: 0,
    etaDate: shipment.etaCurrent,
    slaMet: absorbMet,
    riskLevel: absorbMet ? "low" : "high",
    rationale: absorbMet
      ? "The current ETA still clears the promised date."
      : "No spend, but the promised date is missed.",
  });

  const air = airLaneFor(shipment, lanes, current);
  const alt = altLaneFor(shipment, lanes, current);

  if (alt) {
    const etaDate = shiftDate(shipment.etaCurrent, -daysSaved(current, alt));
    const delta = Math.max(
      0,
      shipment.weightKg * (alt.costPerKg - current.costPerKg),
    );
    options.push({
      kind: "reroute",
      label: `Reroute via ${alt.origin} → ${alt.destination} (${alt.mode})`,
      costUsd: Math.round(delta + REROUTE_FEE_USD),
      etaDate,
      slaMet: meets(etaDate),
      riskLevel: "medium",
      rationale: `Moves to a ${Math.round(alt.reliability * 100)}%-on-time lane at ${alt.transitDays} days transit.`,
    });
  }

  if (air) {
    const etaDate = shiftDate(shipment.etaCurrent, -daysSaved(current, air));
    options.push({
      kind: "split",
      label: "Split — half by air, half stays",
      costUsd: Math.round(
        (shipment.weightKg / 2) * air.costPerKg + SPLIT_HANDLING_USD,
      ),
      etaDate,
      slaMet: meets(etaDate),
      riskLevel: "medium",
      rationale: "Covers immediate demand by air while the balance sails.",
    });
    options.push({
      kind: "expedite",
      label: "Expedite the full shipment by air",
      costUsd: Math.round(shipment.weightKg * air.costPerKg),
      etaDate,
      slaMet: meets(etaDate),
      riskLevel: "low",
      rationale: `Full volume on a ${air.transitDays}-day air lane.`,
    });
  }

  // absorb first (the do-nothing baseline), then cheapest-first.
  const [absorb, ...rest] = options;
  rest.sort((a, b) => a.costUsd - b.costUsd);
  return [absorb, ...rest];
}

export function findOption(
  shipment: Shipment,
  lanes: Lane[],
  kind: MitigationKind,
): MitigationOption | undefined {
  return computeMitigationOptions(shipment, lanes).find((o) => o.kind === kind);
}
