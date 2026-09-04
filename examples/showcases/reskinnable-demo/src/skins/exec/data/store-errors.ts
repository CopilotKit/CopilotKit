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
 * other two. One table means a new code cannot be handled by some verbs and
 * not others.
 */

/**
 * `Map`, never a plain object: the key is a thrown Error's message prefix,
 * which is not a closed set. A plain-object lookup resolves `"constructor"`,
 * `"toString"`, `"__proto__"`, … TRUTHY off the prototype chain and would hand
 * `status: undefined` to `Response.json`, which defaults to 200 — reporting a
 * failed mutation as a success. `Map.get` only sees own entries. (Same
 * reasoning, same shape as `src/skins/commerce/data/http.ts`'s `CODES`.)
 */
const STATUS_BY_CODE: Map<string, number> = new Map([
  ["NOT_FOUND", 404],
  // The block exists and is pinned somewhere else: a conflict with current
  // state, not a missing record. 404 here is what told the agent to re-render
  // a block that already existed.
  ["ALREADY_PINNED", 409],
]);

/**
 * The JSON error response for a `store` throw, or `null` when the error is not
 * one of `store`'s coded failures.
 *
 * `null` rather than a 500 body on purpose: an unrecognised throw is a bug,
 * and the call site re-throws it so Next's error handling logs it with a stack
 * trace instead of it being flattened into a tidy JSON body nobody reads.
 */
export function storeErrorResponse(error: unknown): Response | null {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.split(":", 1)[0];
  const status = STATUS_BY_CODE.get(code);
  if (status === undefined) return null;
  return Response.json({ error: code, message }, { status });
}
