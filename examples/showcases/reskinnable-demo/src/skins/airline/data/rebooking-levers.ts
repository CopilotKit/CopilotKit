/**
 * BEAT 3c — the rebooking search's four levers, in ONE normalized record.
 *
 * This is the flight search everyone in the room has personally used: departure
 * window, nonstop or not, which cabin, and how to sort — plus a top-N. That
 * familiarity is the argument for it. Nobody has to be told what these controls
 * do, so when the agent sets four of them at once the room reads the maneuver
 * rather than the UI.
 *
 * Everything downstream reads this module rather than the raw args: the confirm
 * card's chips, the pushed URL, the page's filter pipeline, and the tool
 * schema's advertised values. Two failures this exists to make impossible, both
 * of which shipped in commerce first:
 *
 *  - **A lever value the view will not honour.** Every value the schema
 *    advertises must have a control on the page and must actually filter. The
 *    enums here ARE the page's control vocabularies, and the cabin one is
 *    `satisfies readonly Cabin[]`, so the tool cannot advertise something the
 *    page ignores.
 *  - **A chip for a lever nobody set.** Arguments STREAM, so the confirm card
 *    renders while `args` is still half-empty. A `?? "all"` default therefore
 *    asserts a choice the agent never made — and can then flip when the real
 *    value arrives. An unset lever is `null` here and gets NO chip.
 *
 * Server-safe on purpose: no React, no JSX, no `"use client"`. It is imported by
 * a client page and a client tool host today, and by `GET /bookings/[id]/options`
 * on the server, so all three read one vocabulary.
 */

import type { Cabin } from "./trip-types";

/**
 * When the option departs, in the DEPARTURE AIRPORT's own clock. Three buckets
 * because that is what every airline search offers; the boundaries are stated
 * once, in `DEPARTURE_WINDOW_RANGES`, and both the filter and the labels read
 * them.
 */
export const DEPARTURE_WINDOWS = ["morning", "afternoon", "evening"] as const;

export type DepartureWindow = (typeof DEPARTURE_WINDOWS)[number];

/**
 * `[fromHour, toHourExclusive)` per window. Exhaustive and non-overlapping over
 * 0–23, which `rebooking-levers.test.ts` asserts: a gap here would be an hour of
 * the day no window matches, so an option departing in it would vanish from
 * every filtered view and appear only in the unfiltered one.
 */
export const DEPARTURE_WINDOW_RANGES: Record<
  DepartureWindow,
  { fromHour: number; toHour: number }
> = {
  morning: { fromHour: 0, toHour: 12 },
  afternoon: { fromHour: 12, toHour: 18 },
  evening: { fromHour: 18, toHour: 24 },
};

export const DEPARTURE_WINDOW_LABELS: Record<DepartureWindow, string> = {
  morning: "Morning (before noon)",
  afternoon: "Afternoon (12:00–18:00)",
  evening: "Evening (after 18:00)",
};

export const STOP_FILTERS = ["nonstop", "one_stop", "two_plus"] as const;

export type StopFilter = (typeof STOP_FILTERS)[number];

export const STOP_LABELS: Record<StopFilter, string> = {
  nonstop: "Nonstop",
  one_stop: "One stop",
  two_plus: "Two or more stops",
};

/**
 * DERIVED from the real `Cabin` union, not hand-copied. `satisfies` makes a
 * value the page cannot honour a BUILD error rather than a lever the confirm
 * card draws and the view silently ignores.
 */
export const CABIN_FILTERS = [
  "economy",
  "premium",
  "business",
] as const satisfies readonly Cabin[];

export type CabinFilter = (typeof CABIN_FILTERS)[number];

export const CABIN_LABELS: Record<CabinFilter, string> = {
  economy: "Economy",
  premium: "Premium economy",
  business: "Business",
};

export const OPTION_SORTS = [
  "price_asc",
  "depart_soonest",
  "duration_asc",
] as const;

export type OptionSort = (typeof OPTION_SORTS)[number];

export const OPTION_SORT_LABELS: Record<OptionSort, string> = {
  price_asc: "Cheapest first",
  depart_soonest: "Departing soonest",
  duration_asc: "Shortest trip first",
};

/**
 * The value a lever takes when it is NOT being pulled — and the reason it exists
 * at all, which logistics measured rather than assumed.
 *
 * These levers were `.optional()` in every skin that shipped before logistics. A
 * model facing an optional enum fills it anyway: told in as many words "do not
 * filter anything, just show me the top 3", gpt-5.4 still returned two filters
 * that no row satisfied, so the maneuver landed on an EMPTY board with four
 * confidently tinted controls. No prompt sentence fixes that, because omission
 * is not a choice a model can state.
 *
 * So the tool advertises this sentinel as a first-class enum member and every
 * lever parameter is REQUIRED. Nothing downstream needs to know: `"all"` is not
 * in the page's control vocabulary, so `normalizeLevers` drops it to `null` by
 * construction — no chip, no query param, no extra branch anywhere.
 */
export const ANY_LEVER = "all";

/** What the TOOL advertises: the page's vocabulary plus the "not pulled" value. */
export const WINDOW_ARGUMENTS = [ANY_LEVER, ...DEPARTURE_WINDOWS] as const;
export const STOPS_ARGUMENTS = [ANY_LEVER, ...STOP_FILTERS] as const;
export const CABIN_ARGUMENTS = [ANY_LEVER, ...CABIN_FILTERS] as const;
export const SORT_ARGUMENTS = [ANY_LEVER, ...OPTION_SORTS] as const;

export interface RebookingLevers {
  window: DepartureWindow | null;
  stops: StopFilter | null;
  cabin: CabinFilter | null;
  sort: OptionSort | null;
  top: number | null;
}

/**
 * A positive integer, or null. REFUSES rather than coerces: a limit the page
 * would ignore must not be drawn as a limit on the confirm card. Zero is the
 * `top` lever's own "not pulled" value — see `ANY_LEVER` for why a lever needs
 * one it can state out loud.
 *
 * Commerce shipped `Math.max(1, Number(raw) || 0)` here, which turned `?top=0`,
 * `?top=-3` and `?top=abc` into a ONE-ROW list — indistinguishable on stage from
 * a legitimately narrow filter result, so a broken lever and a working one
 * looked identical to the room.
 */
export function parseTopLever(
  raw: string | number | null | undefined,
): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const text = String(raw).trim();
  // Digits only: rejects "", " ", "ten", "-5", "2.5", "1e3", "+5", "10px".
  if (!/^[0-9]+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const oneOf = <T extends string>(
  allowed: readonly T[],
  value: unknown,
): T | null =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;

export function normalizeLevers(
  input: Partial<Record<keyof RebookingLevers, unknown>>,
): RebookingLevers {
  return {
    window: oneOf(DEPARTURE_WINDOWS, input.window),
    stops: oneOf(STOP_FILTERS, input.stops),
    cabin: oneOf(CABIN_FILTERS, input.cabin),
    sort: oneOf(OPTION_SORTS, input.sort),
    top: parseTopLever(input.top as string | number | null | undefined),
  };
}

/**
 * One chip per lever that was ACTUALLY set, in the order the controls sit on the
 * page. An unset lever is absent, not defaulted — see this file's header.
 */
export function leverChips(
  levers: RebookingLevers,
): { label: string; value: string }[] {
  const chips: { label: string; value: string }[] = [];
  if (levers.window)
    chips.push({
      label: "Departs",
      value: DEPARTURE_WINDOW_LABELS[levers.window],
    });
  if (levers.stops)
    chips.push({ label: "Stops", value: STOP_LABELS[levers.stops] });
  if (levers.cabin)
    chips.push({ label: "Cabin", value: CABIN_LABELS[levers.cabin] });
  if (levers.sort)
    chips.push({ label: "Sort", value: OPTION_SORT_LABELS[levers.sort] });
  if (levers.top !== null)
    chips.push({ label: "Top", value: `${levers.top} results` });
  return chips;
}

/**
 * The query string for a lever set — built from the SAME record the chips are,
 * so the view the card opens is the view the card just promised. Re-reading the
 * raw args here is how commerce's chips and URL drifted apart.
 */
export function leverQuery(levers: RebookingLevers): string {
  const params = new URLSearchParams();
  if (levers.window) params.set("window", levers.window);
  if (levers.stops) params.set("stops", levers.stops);
  if (levers.cabin) params.set("cabin", levers.cabin);
  if (levers.sort) params.set("sort", levers.sort);
  if (levers.top !== null) params.set("top", String(levers.top));
  return params.toString();
}

export function readLevers(params: URLSearchParams): RebookingLevers {
  return normalizeLevers({
    window: params.get("window"),
    stops: params.get("stops"),
    cabin: params.get("cabin"),
    sort: params.get("sort"),
    top: params.get("top"),
  });
}
