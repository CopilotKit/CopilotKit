/**
 * Shared error mapping — and body decoding — for the `/api/commerce/v1/*` routes.
 *
 * The store throws Errors whose message is a stable CODE; this turns a code into
 * an HTTP status and a human message in one place. Centralising it is not just
 * tidiness — it is how the beat-6 gate stays honest. `BELOW_MARGIN_FLOOR` has
 * exactly ONE message string in the whole app, and it is written here where the
 * "symptom only, never the fix" rule is visible to anyone editing it.
 */

import {
  JUSTIFICATION_MAX_LENGTH,
  JUSTIFICATION_MIN_LENGTH,
} from "./waiver-codes";

/**
 * Codes the routes may surface, mapped to status + a symptom-only message.
 *
 * A `Map` (not a plain object) is load-bearing, for the same reason the page
 * table in `src/skins/keel/skin.tsx` is one: the key is a thrown Error's
 * `message`, which is not a closed set — anything raised inside a route's `try`
 * lands here, including `req.json()`'s SyntaxError and any future `throw` a
 * store helper grows. A plain-object lookup walks the prototype chain, so
 * `"toString"`, `"constructor"`, `"valueOf"`, `"__proto__"`, … all resolve
 * TRUTHY, take the "known code" branch, and hand `status: undefined` to
 * `Response.json` — which defaults to **200**. A failed mutation would be
 * reported to the agent and to the page as a success, with nothing logged.
 * `Map.get` only ever sees own entries, so that state is unrepresentable rather
 * than guarded per call site. `Record<string, …>` could not catch it: the
 * annotation was a lie about a plain object.
 */
const CODES: Map<string, { status: number; message: string }> = new Map([
  ["NOT_FOUND", { status: 404, message: "That record does not exist." }],
  ["ALREADY_DECIDED", { status: 409, message: "That was already decided." }],
  [
    "ALREADY_REFUNDED",
    { status: 409, message: "That return has already been refunded." },
  ],
  [
    "RETURN_NOT_APPROVED",
    {
      status: 409,
      message: "A return has to be approved before it can be refunded.",
    },
  ],
  [
    "ALREADY_FINALIZED",
    { status: 400, message: "That waiver has already been finalized." },
  ],

  // ── The order state machine (store.orderStatusBlocker) ────────────────────
  // 409 for "conflicts with the state this order is already in", matching the
  // ALREADY_* family above; 422 for the (status, exception) PAIR being one no
  // order may hold, matching INVALID_AMOUNT below.
  [
    "ORDER_ALREADY_SETTLED",
    {
      status: 409,
      message: "A fulfilled or cancelled order can no longer be changed.",
    },
  ],
  [
    "ILLEGAL_ORDER_TRANSITION",
    {
      status: 409,
      message: "That order cannot move to that status from where it is.",
    },
  ],
  [
    "EXCEPTION_ON_SETTLED_ORDER",
    {
      status: 422,
      message:
        "A fulfilled or cancelled order cannot carry an exception — " +
        "clear it in the same change.",
    },
  ],
  ["INVALID_AMOUNT", { status: 422, message: "That is not a usable amount." }],

  // ── Beat 5's writes: the closed template set and the field bounds ──────────
  // A notification template is a CLOSED set of four (`NOTIFICATION_TEMPLATES` in
  // `types.ts`) and the free-text fields are length-bounded, because both the
  // Orders page and the beat-3b readable render what was stored. These are the
  // only codes in this map raised by a caller sending something out of range
  // rather than by a domain rule, so they are 400s: the request is wrong, and a
  // first-party caller that hits one has a bug worth surfacing as such.
  [
    "UNKNOWN_TEMPLATE",
    { status: 400, message: "That is not a message template we send." },
  ],
  [
    "ACTOR_NAME_TOO_LONG",
    { status: 400, message: "That name is longer than the record accepts." },
  ],
  [
    "NOTE_TOO_LONG",
    { status: 400, message: "That note is longer than the record accepts." },
  ],
  [
    "REFUND_EXCEEDS_VALUE",
    {
      status: 422,
      message: "A refund cannot exceed what was charged for the item.",
    },
  ],

  // ── BEAT 6: the gate ──────────────────────────────────────────────────────
  // SYMPTOM ONLY. This names the problem — the discounted margin falls under
  // the category floor — and must NEVER mention margin waivers, justifying
  // codes, or any part of the unlock. An agent that can read the recipe out of
  // the error derives it in one round-trip, and the demonstration stops proving
  // that it learned anything. If you are tempted to make this message "more
  // helpful", don't.
  [
    "BELOW_MARGIN_FLOOR",
    {
      status: 422,
      message: "Discounted margin falls below the category floor.",
    },
  ],

  // Rejected WITHOUT enumerating the catalogue, for the same reason.
  [
    "INVALID_WAIVER_CODE",
    { status: 422, message: "That is not a recognized margin waiver code." },
  ],
  // Safe to be specific: the bounds are about the TEXT, not about which codes
  // justify, so naming them leaks nothing about the unlock — and a caller that
  // cannot tell why its filing was refused just retries the same empty string.
  // The numbers come from the constants so the message cannot drift from the
  // rule it describes.
  [
    "INVALID_JUSTIFICATION",
    {
      status: 422,
      message: `A margin waiver needs a written justification of ${JUSTIFICATION_MIN_LENGTH} to ${JUSTIFICATION_MAX_LENGTH} characters.`,
    },
  ],
  [
    "UNKNOWN_CATEGORY",
    { status: 500, message: "No margin floor is defined for that category." },
  ],

  // ── DELIBERATELY ABSENT: the integrity codes ──────────────────────────────
  // `DANGLING_PRODUCT_REF` and `DANGLING_PROMOTION_REF` (see `data/store.ts`)
  // must NOT be added here. They are raised when one of our own records points
  // at a record that no longer exists — never a caller mistake — and the
  // unrecognised branch below is exactly the treatment they need: a 500 AND a
  // `console.error`. Mapping them would make them quiet, because the known-code
  // branch does not log; a bespoke message would also invite the agent to
  // narrate our broken ledger as though it were a rule of the domain. This is
  // pinned by `http.test.ts` — adding either code turns that test red.
]);

/**
 * Map a thrown store error onto a Response.
 *
 * An UNRECOGNISED throw is a **500**, not a 400. Every code above is raised
 * deliberately by `data/store.ts`; anything else reaching here is by definition
 * not a rule the domain models — a bug in this app, a store helper that grew a
 * new `throw` nobody mapped, or a malformed body from one of our OWN callers
 * (every writer of these routes is first-party: the skin's tools and pages, both
 * of which `JSON.stringify` what they send). Calling that a 400 told the agent
 * "you sent something wrong, adjust and retry", so it would retry a server bug
 * forever and narrate a client mistake that never happened; and it meant no
 * commerce route could emit a 5xx at all. 500 + the `console.error` below makes
 * a real fault loud in both places it has to be loud: the browser/agent and the
 * server log.
 *
 * Do NOT add a `SyntaxError` branch here to soften that. A `SyntaxError` reaching
 * this function is indistinguishable from one thrown by our own code several
 * frames down, so treating it as a client mistake would be the same misreport in
 * the other direction. The place to tell an unreadable BODY apart from a store
 * fault is the route boundary, before the store's `try` — see `readJsonBody`
 * below, which the five id-addressed write routes use to answer a deliberate
 * 400. Anything that gets past it and throws is genuinely ours.
 */
export function errorResponse(error: unknown, context: string): Response {
  const code = error instanceof Error ? error.message : "";
  const known = CODES.get(code);
  if (known) {
    return Response.json(
      { error: code, message: known.message },
      { status: known.status },
    );
  }
  console.error(`[commerce/api] ${context}`, error);
  return Response.json(
    { error: "INTERNAL_ERROR", message: "Something went wrong on our side." },
    { status: 500 },
  );
}

/** A parsed body is only ever read field-by-field by these routes. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The outcome of decoding one request body: either the fields to validate, or
 * the finished 400 to return. A discriminated union rather than a `body | null`
 * because the failure carries a Response the route must not rebuild.
 */
export type JsonBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response };

/**
 * Decode a request body OUTSIDE the store's `try`, so an unreadable body and a
 * store defect stay DIFFERENT failures.
 *
 * `await req.json()` used to sit inside the same `try` that wrapped the store
 * call, which put a `SyntaxError` from a truncated or non-JSON body through
 * `errorResponse` — where it is, correctly, an unrecognised code and therefore a
 * logged 500. That is the accepted cost written into `errorResponse`'s own note
 * above, and the fix belongs HERE rather than there: special-casing
 * `SyntaxError` inside `errorResponse` would misreport a genuine server-side
 * `SyntaxError` (one thrown by our own code, several frames down) as a client
 * mistake — the same defect one level lower. Splitting the two domains at the
 * route boundary is what makes the distinction sound: at this line, the only
 * thing that can fail is reading the caller's bytes, so a failure here IS a bad
 * request and nothing else. Everything the store raises still reaches
 * `errorResponse` untouched, unrecognised codes included.
 *
 * `recordId` is REQUIRED, and appears both in the log line and in the message.
 * "malformed body" with no id told a presenter watching the server log that
 * something failed but not which order, and these five routes are the ones the
 * demo drives by id.
 *
 * A top-level non-object (`5`, `"x"`, `[]`, `null`) parses fine and simply
 * carries no fields, so it is normalised to an empty bag and falls through to
 * each route's own field validation exactly as it did when `req.json()` handed
 * back `any`. It is not a parse failure and must not be reported as one.
 */
export async function readJsonBody(
  req: { json: () => Promise<unknown> },
  context: string,
  recordId: string,
): Promise<JsonBodyResult> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch (error) {
    console.warn(
      `[commerce/api] ${context} id=${recordId} unreadable request body`,
      error,
    );
    return {
      ok: false,
      response: Response.json(
        {
          error: "MALFORMED_BODY",
          message: `That request body is not readable JSON (record ${recordId}).`,
        },
        { status: 400 },
      ),
    };
  }
  return { ok: true, body: isRecord(parsed) ? parsed : {} };
}

/**
 * Read a money figure out of a parsed JSON body, refusing COERCION.
 *
 * `Number(body?.amount)` was the original spelling in the refund route, and it
 * is a money bug rather than a validation nicety: `Number(true)` is `1`, a
 * finite, positive, under-the-ceiling figure that satisfies every rule
 * `issueRefund` has and therefore SETTLES the return — terminally, for a dollar,
 * with a 200. `Number("12")` is likewise a refund nobody's JSON meant to
 * authorize. (`[]`, `null` and `""` all coerce to 0 and were caught by the
 * store's `<= 0` rule, which is why the hole was invisible: five of the seven
 * malformed bodies already answered 422.)
 *
 * So the type is checked here, at the only place untrusted JSON enters, and a
 * non-number is refused OUTRIGHT rather than converted into whatever number
 * JavaScript thinks it resembles. `Number.isFinite` rides along because
 * `JSON.parse` turns an overflowing literal (`1e999`) into `Infinity`, which is
 * a `number` and is not a figure.
 *
 * What this deliberately does NOT do is re-check the domain range. `> 0` and
 * `<= itemValue` stay in `store.issueRefund`, single-sourced, so the ceiling
 * applies however a refund is issued; forking them into the route would make one
 * rule live in two files and drift. The two halves are complementary: this
 * guarantees the store receives a real finite number, the store decides whether
 * that number is an acceptable refund.
 */
export function requireAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("INVALID_AMOUNT");
  return value;
}
