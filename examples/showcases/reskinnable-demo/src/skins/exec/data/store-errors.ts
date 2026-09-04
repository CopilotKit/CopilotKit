/**
 * The ONE place a thrown `store` error becomes an HTTP status, shared by the
 * dashboard-blocks routes under `/api/exec/v1/dashboards` — the collection
 * POST and the per-block DELETE/PATCH.
 *
 * `store`'s block mutators signal failure by throwing an Error whose message
 * is `"<CODE>: <human message>"` (see `addBlockToDashboard`, `removeBlock`,
 * `moveBlock` in `./store.ts`). Each route's job is to turn that into the
 * status the code means and forward the message verbatim, because the message
 * is the only thing that says WHICH id or dashboard was involved — the part
 * both the presenter and the agent need to act.
 *
 * Centralised for a reason the POST/DELETE/PATCH split made concrete: the
 * three routes act on the same resource, and when only POST translated its
 * throws, an unknown blockId was a 404 through one verb and a 200 through the
 * other two. One table for the BLOCK ROUTES means a new code cannot be
 * handled by some verbs and not others.
 *
 * SCOPE — what this table is not:
 *
 *  - `build-block-ops.ts` throws `UNKNOWN_BLOCK_KIND` and `METRIC_ID_REQUIRED`
 *    in this same `CODE: message` convention (its `assertValidBlockSpec` doc
 *    comment points here for the spelling), and they are deliberately absent
 *    below. Neither is reachable through these routes: the routes take a
 *    `blockId`, never a `BlockSpec`, and every path that can carry a spec —
 *    `agent.ts`'s `render_metric_block` guard, `store.createDraftBlock`, the
 *    ledger GET's op rebuild — screens it upstream. A spec that still gets
 *    through is a BUG, and the `null` return below is what keeps it a logged
 *    500 with a stack rather than a tidy 4xx that reads like a user error.
 *    Add them here only alongside a route that can actually raise them.
 *  - `store.publishPack`'s refusals (`BAD_COUNTERSIGN`, `NOT_FOUND`,
 *    `EMPTY_DASHBOARD`, `UNEXPLAINED_VARIANCE`) never reach here either: it
 *    RETURNS a discriminated result carrying its own `status`, and the packs
 *    route forwards that verbatim. Nothing to map.
 */

/**
 * `Map`, never a plain object: the key is a thrown Error's message prefix,
 * which is not a closed set — anything raised inside a route's `try` lands
 * here, including a `SyntaxError` from `req.json()` and whatever a future
 * `throw` spells. On a plain object, `"constructor"`, `"toString"`,
 * `"valueOf"`, `"__proto__"`, … all resolve off the PROTOTYPE CHAIN, and what
 * comes back is a truthy function rather than a number: it sails past the
 * `status === undefined` guard below, takes the "known code" branch, and hands
 * `Response.json` a status that is not an integer — a `RangeError` thrown out
 * of the route, i.e. a 500 with a stack pointing at the wrong place, for an
 * error that was never a coded one. `Map.get` only ever sees own entries, so
 * that state is unrepresentable instead of guarded per call site.
 * (`src/skins/commerce/data/http.ts`'s `CODES` is a `Map` for the same reason,
 * though it holds `{ status, message }` — commerce REPLACES the thrown message
 * with a fixed symptom-only string; here the thrown message IS the payload,
 * because it is the only thing naming which id and which dashboard.)
 */
const STATUS_BY_CODE: Map<string, number> = new Map([
  ["NOT_FOUND", 404],
  // The block exists and is pinned somewhere else: a conflict with current
  // state, not a missing record. 404 here is what told the agent to re-render
  // a block that already existed.
  ["ALREADY_PINNED", 409],
]);

/**
 * The `CODE: message` string a thrown value carries, for any shape of throw.
 *
 * `instanceof Error` is not enough and `String(error)` is not a safe fallback:
 * `Error.prototype.toString` PREFIXES the name, so a cross-realm Error (thrown
 * across a realm boundary — Next's server/edge split, a `vm` context — where
 * the `instanceof` identity check fails although it really is an Error)
 * stringified to `"Error: NOT_FOUND: …"`, whose first `:`-delimited field is
 * `"Error"`. A plain thrown object fared worse: `"[object Object]"`. Either
 * way the code never matched, the response was `null`, and a mapped 404 came
 * back as a re-thrown 500. Reading `.message` off anything that has a string
 * one covers all three shapes; `String` stays as the last resort for a thrown
 * primitive, where it is exact.
 */
function codedMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error as { message: unknown };
    if (typeof message === "string") return message;
  }
  return String(error);
}

/**
 * The JSON error response for a `store` throw, or `null` when the error is not
 * one of `store`'s coded failures.
 *
 * `null` rather than a 500 body on purpose: an unrecognised throw is a bug,
 * and the call site re-throws it so Next's error handling logs it with a stack
 * trace instead of it being flattened into a tidy JSON body nobody reads.
 */
export function storeErrorResponse(error: unknown): Response | null {
  const message = codedMessage(error);
  const code = message.split(":", 1)[0];
  const status = STATUS_BY_CODE.get(code);
  if (status === undefined) return null;
  return Response.json({ error: code, message }, { status });
}
