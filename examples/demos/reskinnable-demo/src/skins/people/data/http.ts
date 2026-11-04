/**
 * Shared error mapping for the `/api/people/v1/*` routes.
 *
 * The store throws Errors whose message is a stable CODE; this turns a code
 * into an HTTP status and a human message in one place. Centralising it is not
 * just tidiness — it is how the beat-6 gate stays honest. `OUT_OF_BAND` has
 * exactly ONE message string in the whole app, and it is written here where the
 * "symptom only, never the fix" rule is visible to anyone editing it.
 */

/** Codes the routes may surface, mapped to status + a symptom-only message. */
const CODES: Record<string, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: "That record does not exist." },
  BUDDY_NOT_FOUND: { status: 404, message: "That buddy does not exist." },
  SELF_BUDDY: { status: 422, message: "Someone cannot be their own buddy." },
  ALREADY_DECIDED: {
    status: 409,
    message: "That request was already decided.",
  },
  ALREADY_FINALIZED: {
    status: 400,
    message: "That exception has already been finalized.",
  },
  INVALID_SALARY: {
    status: 422,
    message: "That is not a usable salary figure.",
  },

  // ── BEAT 6: the gate ──────────────────────────────────────────────────────
  // SYMPTOM ONLY. This names the problem — the figure sits outside the band —
  // and must NEVER mention band exceptions, justifying codes, or any part of
  // the unlock. An agent that can read the recipe out of the error derives it
  // in one round-trip, and the demonstration stops proving that it learned
  // anything. If you are tempted to make this message "more helpful", don't.
  OUT_OF_BAND: {
    status: 422,
    message: "Compensation band exceeded for the proposed level.",
  },

  // Rejected WITHOUT enumerating the catalogue, for the same reason.
  INVALID_EXCEPTION_CODE: {
    status: 422,
    message: "That is not a recognized band exception code.",
  },
  UNKNOWN_LEVEL: { status: 500, message: "No band is defined for that level." },
};

/** Map a thrown store error onto a Response. Unknown errors become a 400. */
export function errorResponse(error: unknown, context: string): Response {
  const code = error instanceof Error ? error.message : "";
  const known = CODES[code];
  if (known) {
    return Response.json(
      { error: code, message: known.message },
      { status: known.status },
    );
  }
  console.error(`[people/api] ${context}`, error);
  return Response.json(
    { error: "BAD_REQUEST", message: "Bad request." },
    { status: 400 },
  );
}
