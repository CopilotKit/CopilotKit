/**
 * BEAT 3c — the Control Tower's four levers, in ONE normalized record.
 *
 * Everything downstream reads this module rather than the raw args: the confirm
 * card's chips, the pushed URL, the page's filter pipeline, and the tool
 * schema's advertised values. Two failures this exists to make impossible, both
 * of which shipped in commerce first:
 *
 *  - **A lever value the view will not honour.** Every value the schema
 *    advertises must have a control on the page and must actually filter. The
 *    enums here ARE the page's control vocabularies, so the tool cannot
 *    advertise something the page ignores.
 *  - **A chip for a lever nobody set.** Arguments STREAM, so the confirm card
 *    renders while `args` is still half-empty. A `?? "all"` default therefore
 *    asserts a choice the agent never made — and can then flip when the real
 *    value arrives. An unset lever is `null` here and gets NO chip.
 *
 * Server-safe on purpose: no React, no JSX, no `"use client"`. It is imported by
 * a client page and a client tool host today, but nothing here would stop the
 * agent module reading the same vocabularies if it ever needs to.
 */

import type { ExceptionCode, Shipment } from "./types";

/**
 * DERIVED from the real unions, not hand-copied. `satisfies` makes a value the
 * page cannot honour a BUILD error rather than a lever the confirm card draws
 * and the view silently ignores — which is exactly how commerce shipped a
 * `status: "cancelled"` the ledger readable filtered out.
 */
export const EXCEPTION_FILTERS = [
  "PORT_CONGESTION",
  "CUSTOMS_HOLD",
  "CARRIER_DELAY",
  "WEATHER",
  "CAPACITY_SHORTFALL",
  "DOC_MISMATCH",
] as const satisfies readonly ExceptionCode[];

export const STATUS_FILTERS = [
  "on_track",
  "at_risk",
  "delayed",
  "resolved",
] as const satisfies readonly Shipment["status"][];

export const EXCEPTION_SORTS = [
  "value_desc",
  "eta_slip_desc",
  "promise_breach_first",
] as const;

/**
 * The value a lever takes when it is NOT being pulled — and the reason it exists
 * at all, which is measured rather than assumed.
 *
 * `showExceptionQueue`'s levers were `.optional()` first. A model facing an
 * optional enum fills it anyway: told in as many words "take me to the Control
 * Tower, do not filter anything, just limit it to the top 3 rows", gpt-5.4 still
 * returned `exception=PORT_CONGESTION` AND `status=on_track` — a pair no
 * shipment satisfies, so the maneuver landed on an EMPTY board. There is no
 * prompt sentence that reliably fixes that, because the model has no way to SAY
 * "no filter"; omission is not a choice it can make explicit.
 *
 * So the tool advertises this sentinel as a first-class enum member and the
 * parameter is REQUIRED — the same shape commerce's `showOrderQueue` arrived at
 * with its own "all". Nothing downstream needs to know: `"all"` is not in the
 * page's control vocabulary, so `normalizeLevers` drops it to `null` by
 * construction, which draws NO chip and writes NO query param.
 */
export const ANY_LEVER = "all";

/** What the TOOL advertises: the page's vocabulary plus the "not pulled" value. */
export const EXCEPTION_ARGUMENTS = [ANY_LEVER, ...EXCEPTION_FILTERS] as const;
export const STATUS_ARGUMENTS = [ANY_LEVER, ...STATUS_FILTERS] as const;
export const SORT_ARGUMENTS = [ANY_LEVER, ...EXCEPTION_SORTS] as const;

export type ExceptionFilter = (typeof EXCEPTION_FILTERS)[number];
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export type ExceptionSort = (typeof EXCEPTION_SORTS)[number];

/**
 * Labels are keyed by the tuple's OWN element type, so adding a lever value
 * without a human label is a type error. That is the same guarantee the enums
 * give the page — stated once more at the layer the confirm card reads, because
 * an unlabelled chip is a chip that reads `undefined` on stage.
 */
export const EXCEPTION_SORT_LABELS: Record<ExceptionSort, string> = {
  value_desc: "Highest value first",
  eta_slip_desc: "Biggest ETA slip first",
  promise_breach_first: "Promise breaches first",
};

export const EXCEPTION_LABELS: Record<ExceptionFilter, string> = {
  PORT_CONGESTION: "Port congestion",
  CUSTOMS_HOLD: "Customs hold",
  CARRIER_DELAY: "Carrier delay",
  WEATHER: "Weather",
  CAPACITY_SHORTFALL: "Capacity shortfall",
  DOC_MISMATCH: "Document mismatch",
};

export const STATUS_LABELS: Record<StatusFilter, string> = {
  on_track: "On track",
  at_risk: "At risk",
  delayed: "Delayed",
  resolved: "Resolved",
};

export interface ExceptionLevers {
  exception: ExceptionFilter | null;
  status: StatusFilter | null;
  sort: ExceptionSort | null;
  top: number | null;
}

/**
 * A positive integer, or null. Refuses rather than coerces: a limit the page
 * would ignore must not be drawn as a limit on the confirm card. Zero is the
 * `top` lever's own "not pulled" value — see `ANY_LEVER` for why a lever needs
 * one it can state out loud.
 *
 * Commerce shipped `Math.max(1, Number(raw) || 0)` here, which turned `?top=0`,
 * `?top=-3` and `?top=abc` into a ONE-ROW queue — indistinguishable on stage
 * from a legitimately narrow filter result, so a broken lever and a working one
 * looked identical to the room. An unusable value behaves as if the lever were
 * absent instead: full list, control untinted, no chip.
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
  input: Partial<Record<keyof ExceptionLevers, unknown>>,
): ExceptionLevers {
  return {
    exception: oneOf(EXCEPTION_FILTERS, input.exception),
    status: oneOf(STATUS_FILTERS, input.status),
    sort: oneOf(EXCEPTION_SORTS, input.sort),
    top: parseTopLever(input.top as string | number | null | undefined),
  };
}

/**
 * One chip per lever that was ACTUALLY set, in the order the controls sit on the
 * page. An unset lever is absent, not defaulted — see this file's header.
 */
export function leverChips(
  levers: ExceptionLevers,
): { label: string; value: string }[] {
  const chips: { label: string; value: string }[] = [];
  if (levers.exception)
    chips.push({
      label: "Exception",
      value: EXCEPTION_LABELS[levers.exception],
    });
  if (levers.status)
    chips.push({ label: "Status", value: STATUS_LABELS[levers.status] });
  if (levers.sort)
    chips.push({ label: "Sort", value: EXCEPTION_SORT_LABELS[levers.sort] });
  if (levers.top !== null)
    chips.push({ label: "Top", value: `${levers.top} rows` });
  return chips;
}

/**
 * The query string for a lever set — built from the SAME record the chips are,
 * so the view the card opens is the view the card just promised. Re-reading the
 * raw args here is how commerce's chips and URL drifted apart.
 */
export function leverQuery(levers: ExceptionLevers): string {
  const params = new URLSearchParams();
  if (levers.exception) params.set("exception", levers.exception);
  if (levers.status) params.set("status", levers.status);
  if (levers.sort) params.set("sort", levers.sort);
  if (levers.top !== null) params.set("top", String(levers.top));
  return params.toString();
}

export function readLevers(params: URLSearchParams): ExceptionLevers {
  return normalizeLevers({
    exception: params.get("exception"),
    status: params.get("status"),
    sort: params.get("sort"),
    top: params.get("top"),
  });
}
