/**
 * Pure derivations shared by the pages, the gen-UI components, the agent's
 * readables and the sandbox functions.
 *
 * These deliberately DO NOT import `store.ts`. The store is the server's
 * in-memory ledger; importing it from a client component would bundle the whole
 * seed into the browser and create a second, silently divergent copy of the
 * data — so everything here takes the bands it needs as an argument, sourced
 * from the one snapshot the ledger context fetched.
 */

import type {
  Band,
  BandPosition,
  Employee,
  Level,
  PeopleRequest,
} from "./types";

const DAY_MS = 86_400_000;

export const formatSalary = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

/** "$163k" — for axis labels and dense chips where the full figure won't fit. */
export const formatCompact = (n: number) =>
  `$${Math.round(n / 1000).toLocaleString("en-US")}k`;

export const formatPercent = (ratio: number) => `${Math.round(ratio * 100)}%`;

export function bandFor(bands: Band[], level: Level): Band | undefined {
  return bands.find((b) => b.level === level);
}

/**
 * Where a salary sits inside its band. Mirrors `store.bandPosition` exactly —
 * including the split between the CLAMPED `ratio` (which positions the dot on
 * the rail) and the RAW `outOfBand` test (which decides whether it is flagged).
 * Clamping the ratio must never be allowed to hide a violation.
 */
export function bandPosition(
  bands: Band[],
  salary: number,
  level: Level,
): BandPosition | null {
  const band = bandFor(bands, level);
  if (!band) return null;
  const span = band.max - band.min;
  const raw = span === 0 ? 0.5 : (salary - band.min) / span;
  return {
    level: band.level,
    min: band.min,
    mid: band.mid,
    max: band.max,
    ratio: Math.min(1, Math.max(0, raw)),
    outOfBand: salary < band.min || salary > band.max,
    side: salary < band.min ? "below" : salary > band.max ? "above" : null,
  };
}

export function isOutOfBand(bands: Band[], employee: Employee): boolean {
  return (
    bandPosition(bands, employee.baseSalary, employee.level)?.outOfBand ?? false
  );
}

/** Whole days since an ISO timestamp. Never negative. */
export function ageInDays(iso: string): number {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS),
  );
}

/** Signed days until a date — negative once it is in the past. */
export function daysUntil(isoDate: string): number {
  return Math.round((new Date(isoDate).getTime() - Date.now()) / DAY_MS);
}

/** "2 yr 5 mo", "7 mo", "18 days", or "starts in 4 days" for a future joiner. */
export function tenureLabel(startDate: string): string {
  const until = daysUntil(startDate);
  if (until > 0)
    return until === 1 ? "starts tomorrow" : `starts in ${until} days`;
  const days = -until;
  // Below a month, count days. Flooring straight to months rendered a
  // three-week-old hire as "0 mo", which reads as missing data rather than as
  // someone who just joined — and the newest people are the ones this page
  // exists for.
  if (days === 0) return "starts today";
  if (days < 31) return days === 1 ? "1 day" : `${days} days`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? `${years} yr` : `${years} yr ${rest} mo`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * A stable hue per person, derived from their name.
 *
 * Rowan puts a monogram tile on nearly every row, and random colours would make
 * the roster read as confetti while identical colours would make it read as a
 * spreadsheet. A deterministic hash gives each person a colour they KEEP —
 * across pages, across reloads, and inside chat gen-UI — so a face becomes
 * recognisable at a glance. The range is deliberately narrow and desaturated in
 * use (see Monogram) so the plum chrome stays the loudest thing on screen.
 */
export function monogramHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 360;
  }
  return hash;
}

export const REQUEST_KIND_LABEL: Record<PeopleRequest["kind"], string> = {
  "time-off": "Time off",
  equipment: "Equipment",
  "role-change": "Role change",
  "referral-bonus": "Referral bonus",
  training: "Training",
};

/** The amount-or-days summary a request row shows on its right edge. */
export function requestValueLabel(request: PeopleRequest): string {
  if (request.days !== undefined) {
    return request.days === 1 ? "1 day" : `${request.days} days`;
  }
  if (request.amount !== undefined) return formatSalary(request.amount);
  return "—";
}
