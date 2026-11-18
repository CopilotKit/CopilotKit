/**
 * Reading the AIRPORT'S OWN CLOCK out of an ISO string, without `Date`.
 *
 * Every timestamp in the REST substrate carries its airport's UTC offset
 * ("2026-07-21T18:55:00-05:00"), so the local wall-clock time is already in the
 * string. `new Date(iso).getHours()` would re-express it in whatever timezone
 * the process happens to run in — so an evening departure from Lima renders as
 * an afternoon one on a CI box in another zone, and a render test asserting the
 * painted text passes or fails depending on where it runs.
 *
 * `data/rebooking-options.ts`'s `localHourOf` makes exactly this argument for
 * the FILTER side. These are its display counterparts, and they must agree with
 * it: a board that filters on the string's hour but prints `Date`'s hour would
 * show "18:55" under a morning filter on half the world's machines.
 *
 * Every function returns "" on anything it cannot read, and callers render that
 * as an em dash rather than inventing midnight.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

interface Parts {
  year: string;
  month: number;
  day: number;
  hour: string;
  minute: string;
}

function parse(iso: string): Parts | null {
  const m = ISO.exec(String(iso ?? "").trim());
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return {
    year: m[1]!,
    month,
    day,
    hour: m[4]!,
    minute: m[5]!,
  };
}

/** "18:40" — the departure board time, in the airport's own clock. */
export function localClock(iso: string): string {
  const p = parse(iso);
  return p ? `${p.hour}:${p.minute}` : "";
}

/** "21 Jul" — no year, because every seeded trip sits in one season. */
export function localDate(iso: string): string {
  const p = parse(iso);
  return p ? `${p.day} ${MONTHS[p.month - 1]}` : "";
}

/** "21 Jul 18:40" — the two joined, for a single-column table cell. */
export function localDateTime(iso: string): string {
  const p = parse(iso);
  return p ? `${localDate(iso)} ${localClock(iso)}` : "";
}

/** "3h 55m", from a duration already in minutes. */
export function durationLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
