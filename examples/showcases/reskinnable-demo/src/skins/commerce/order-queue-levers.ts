import {
  EXCEPTION_FILTERS,
  ORDER_SORTS,
  ORDER_STATUS_FILTERS,
} from "./data/derive";
import type { ExceptionFilter, OrderSort, StatusFilter } from "./data/derive";
import { parseTopLever } from "./pages/orders";

/**
 * BEAT 3c's lever contract, pulled out of the `showOrderQueue` card so the chips
 * it draws, the URL it pushes and the Orders page's own controls cannot say
 * three different things.
 *
 * Beat 3c's whole claim is that the assistant reached into the app's REAL
 * controls. Two ways the card falsified that, both of which this module makes
 * unrepresentable:
 *
 *  1. A CHIP FOR A LEVER NOBODY SET. The Sort chip was written as a ternary
 *     ending in a bare `: "oldest first"`, so an `args.sort` that had not
 *     arrived yet — arguments STREAM, and the card renders throughout — asserted
 *     `aging_desc` on the agent's behalf, and could then flip to something else.
 *     Status, exception and top-N each did the same through a `?? "all"`. Now a
 *     lever that was not set gets NO chip: `queueLeverChips` reads the same
 *     normalized record `queueLeverQuery` builds the URL from, so a chip cannot
 *     claim a maneuver the navigation will not perform.
 *
 *  2. A VALUE THE VIEW WOULD NOT HONOUR. `top` is a raw number on the wire, and
 *     the page IGNORES anything that is not a positive integer (see
 *     `parseTopLever`) — so `top: 2.5` drew a "top 2.5" chip over a full,
 *     unlimited list. It is now run through the page's OWN parser, on the very
 *     string the query string will carry, which is why the two cannot drift.
 *
 * Everything the schema advertises is likewise taken from the page's control
 * vocabularies (`ORDER_STATUS_FILTERS`, `EXCEPTION_FILTERS`, `ORDER_SORTS` in
 * `data/derive`) rather than hand-copied, so the advertised lever set IS the
 * control set.
 */

/**
 * The card sees arguments MID-STREAM, so every field is optional and no field
 * can be trusted to hold a schema value yet. Deliberately widened past the
 * schema's own types for that reason: this is the untrusted shape, and
 * `normalizeQueueLevers` is what turns it into the trusted one.
 */
export interface QueueLeverArgs {
  status?: string;
  exception?: string;
  sort?: string;
  top?: number;
}

/** A lever is `null` when it was not set, or was set to something unusable. */
export interface QueueLevers {
  status: StatusFilter | null;
  exception: ExceptionFilter | null;
  sort: OrderSort | null;
  top: number | null;
}

/** Chip labels for the sorts. `Record<OrderSort, …>` — no sort can lack one. */
const SORT_CHIP_LABEL: Record<OrderSort, string> = {
  aging_desc: "oldest first",
  aging_asc: "newest first",
  value_desc: "largest value",
};

const member = <T extends string>(
  vocabulary: readonly string[],
  value: unknown,
): T | null =>
  typeof value === "string" && vocabulary.includes(value) ? (value as T) : null;

/**
 * The levers as the navigation will actually apply them. A value outside the
 * page's vocabulary is dropped rather than passed through — the same rule
 * `parseTopLever` follows, and the same rule the page applies when it reads the
 * query string back.
 */
export function normalizeQueueLevers(
  args: QueueLeverArgs | undefined,
): QueueLevers {
  return {
    status: member<StatusFilter>(ORDER_STATUS_FILTERS, args?.status),
    exception: member<ExceptionFilter>(EXCEPTION_FILTERS, args?.exception),
    sort: member<OrderSort>(ORDER_SORTS, args?.sort),
    // Through the page's own parser, on the exact string `queueLeverQuery` would
    // put in the URL, so "what the chip claims" and "what the page will do" are
    // one decision instead of two.
    top:
      args?.top === undefined || args.top === null
        ? null
        : parseTopLever(String(args.top)),
  };
}

/**
 * The query string for these levers.
 *
 * `all` is omitted for status and exception because ABSENT is how the page
 * expresses it — the "all" control tints when the param is missing, so writing
 * `?status=all` would be a longer URL for the identical view.
 */
export function queueLeverQuery(levers: QueueLevers): string {
  const params = new URLSearchParams();
  if (levers.status && levers.status !== "all")
    params.set("status", levers.status);
  if (levers.exception && levers.exception !== "all")
    params.set("exception", levers.exception);
  if (levers.sort) params.set("sort", levers.sort);
  if (levers.top !== null) params.set("top", String(levers.top));
  return params.toString();
}

/**
 * One chip per lever that was actually set — and nothing for one that was not.
 *
 * An empty list is a legitimate state (arguments still streaming); the card
 * draws no chip strip at all rather than a row of invented defaults.
 */
export function queueLeverChips(levers: QueueLevers): string[] {
  const chips: string[] = [];
  if (levers.status) chips.push(`Status · ${levers.status}`);
  if (levers.exception) chips.push(`Exception · ${levers.exception}`);
  if (levers.sort) chips.push(`Sort · ${SORT_CHIP_LABEL[levers.sort]}`);
  if (levers.top !== null) chips.push(`Show · top ${levers.top}`);
  return chips;
}
