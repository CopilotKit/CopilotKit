/**
 * BEAT 3c — the pipeline the rebooking search's levers drive.
 *
 * One `useMemo` on the page calls `applyLevers` and reads BOTH lengths off the
 * result. That is not a convenience: commerce shipped a "Top 10 of 22" caption
 * whose denominator came from `data.orders.length` while 13 rows matched, so the
 * single number the room is asked to read as proof of the maneuver instead said
 * the filters did nothing. `matching` (levers applied) and `visible` (`matching`
 * truncated to `top`) come out of ONE pipeline here so the caption, the rows and
 * the agent readable cannot disagree.
 *
 * Server-safe: plain TypeScript, no React, no JSX, no `"use client"`.
 */

import { DEPARTURE_WINDOW_RANGES } from "./rebooking-levers";
import type {
  DepartureWindow,
  RebookingLevers,
  StopFilter,
} from "./rebooking-levers";
import type { RebookingOption } from "./trip-types";

/**
 * The hour an option departs in the DEPARTURE AIRPORT's own clock, read out of
 * the ISO string rather than through `Date`.
 *
 * Deliberate: `new Date(iso).getHours()` answers in whatever timezone the
 * process happens to run in, so an evening departure from Lima would filter as
 * an afternoon one on a CI box in another zone — a lever that quietly returns
 * different rows depending on where the server sits. Every timestamp in this
 * substrate carries its airport's offset, so the local hour is already in the
 * string.
 *
 * Returns `null` on anything that is not an ISO datetime, and callers treat that
 * as "matches no window" rather than as midnight.
 */
export function localHourOf(iso: string): number | null {
  const match = /^\d{4}-\d{2}-\d{2}T(\d{2}):\d{2}/.exec(iso.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  return hour >= 0 && hour <= 23 ? hour : null;
}

/** Which departure window an option falls in, or `null` when it is unreadable. */
export function departureWindowOf(
  option: RebookingOption,
): DepartureWindow | null {
  const hour = localHourOf(option.departureLocal);
  if (hour === null) return null;
  for (const [window, range] of Object.entries(DEPARTURE_WINDOW_RANGES)) {
    if (hour >= range.fromHour && hour < range.toHour) {
      return window as DepartureWindow;
    }
  }
  return null;
}

/** Which stop bucket an option falls in. Negative stop counts read as nonstop. */
export function stopBucketOf(option: RebookingOption): StopFilter {
  if (option.stops <= 0) return "nonstop";
  if (option.stops === 1) return "one_stop";
  return "two_plus";
}

export const optionsForBooking = (
  options: RebookingOption[],
  bookingId: string,
): RebookingOption[] => options.filter((o) => o.bookingId === bookingId);

export const findOption = (
  options: RebookingOption[],
  optionId: string,
): RebookingOption | undefined => options.find((o) => o.id === optionId);

const COMPARATORS: Record<
  NonNullable<RebookingLevers["sort"]>,
  (a: RebookingOption, b: RebookingOption) => number
> = {
  price_asc: (a, b) =>
    a.fareDifferenceUsd - b.fareDifferenceUsd ||
    a.departureLocal.localeCompare(b.departureLocal) ||
    a.id.localeCompare(b.id),
  depart_soonest: (a, b) =>
    a.departureLocal.localeCompare(b.departureLocal) ||
    a.id.localeCompare(b.id),
  duration_asc: (a, b) =>
    a.durationMinutes - b.durationMinutes ||
    a.departureLocal.localeCompare(b.departureLocal) ||
    a.id.localeCompare(b.id),
};

export interface LeveredOptions {
  /** Every option the levers admit, before `top` truncates anything. */
  matching: RebookingOption[];
  /** `matching`, truncated to `top` when that lever is pulled. */
  visible: RebookingOption[];
}

/**
 * Filter, sort and truncate — in that order, publishing both lengths.
 *
 * An unset lever filters nothing (it is `null`, not a default), and an unset
 * sort leaves the seed order alone rather than imposing one nobody asked for.
 * `matching` is a fresh array, so the caller cannot sort the store in place.
 */
export function applyLevers(
  options: RebookingOption[],
  levers: RebookingLevers,
): LeveredOptions {
  const matching = options.filter((option) => {
    if (levers.window && departureWindowOf(option) !== levers.window) {
      return false;
    }
    if (levers.stops && stopBucketOf(option) !== levers.stops) return false;
    if (levers.cabin && option.cabin !== levers.cabin) return false;
    return true;
  });

  if (levers.sort) matching.sort(COMPARATORS[levers.sort]);

  return {
    matching,
    visible: levers.top === null ? matching : matching.slice(0, levers.top),
  };
}
