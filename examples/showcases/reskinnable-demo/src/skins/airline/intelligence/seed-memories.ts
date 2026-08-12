/**
 * BEATS 4 AND 5 — the memory Aeronova is supposed to start out already having.
 * Server-safe plain .ts. Called by `dev/reset` immediately after wiping learned
 * memory, so the demo is re-armed before the presenter says a word.
 *
 * "It already knows me" is a FILE, not emergent behaviour. Four rules govern what
 * belongs here:
 *
 *  1. Seed a standing PREFERENCE, not a fact. "Camila's favourite airport" proves
 *     storage. "Aisle, forward of the wing, never Basic Economy, and quote every
 *     departure in her home clock" proves APPLIED learning, because recall
 *     visibly changes the answer to a question the passenger never re-explained.
 *
 *  2. The procedure must run FULLY AUTOMATICALLY. Banking's equivalent once
 *     opened a confirmation card mid-procedure; when a presenter moved on without
 *     answering it, that tool call sat unresolved and the NEXT message failed the
 *     whole thread with "Tool result is missing for tool call ...". A procedure
 *     with no half-finished state has nothing to leave behind, so "run all three
 *     immediately, in order, without asking for confirmation" is written into the
 *     memory text itself, not just the prompt.
 *
 *  3. NEVER seed beat 6's fare-exception procedure. Getting a change through on a
 *     ticket whose fare refuses one is the procedure Aeronova has to be TAUGHT on
 *     stage. Seed it and the concierge already knows the answer, never offers to
 *     record, and the entire teach arc disappears — which is exactly the kind of
 *     failure that still compiles and still looks fine right up until the demo.
 *     THE OMISSION BELOW IS DELIBERATE. The beat-5 memory says so explicitly so
 *     the two procedures can never be confused for one another, and
 *     `seed-memories.test.ts` asserts that no waiver category appears in this
 *     file at all — a seeded memory is read straight into the model's context, so
 *     it is a sixth leak channel for beat 6's withheld vocabulary.
 *
 *  4. NOTHING HERE MAY NAME A FARE-EXCEPTION CATEGORY, for the reason in rule 3.
 *     The beat-5 memory names its own three writes and their arguments, all of
 *     which come from `data/handling.ts` — the module that deliberately shares no
 *     token with `data/fare-waiver-codes.ts`.
 */

/**
 * Per-request timeout. A presenter reset seeds several buckets serially right
 * after sweeping them, all in one request — with no bound, one wedged POST leaves
 * the Reset button spinning forever. A timeout here fails the way this function
 * already fails: counted and logged, never thrown.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface SeedMemoriesParams {
  apiUrl: string;
  apiKey: string;
  userId: string;
  /** Per-request timeout in ms. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
}

interface SeedMemory {
  kind: "topical" | "episodic" | "operational";
  scope: "user" | "project";
  content: string;
}

export const SEED_MEMORIES: readonly SeedMemory[] = [
  {
    // ── BEAT 4 ──────────────────────────────────────────────────────────────
    // A standing preference about SHAPE and CHOICE, so recall changes the answer
    // rather than adding a fact. Four separate, checkable clauses — a
    // single-clause preference is too easy for the audience to read as a
    // coincidence, and `data/beat-map.md` § "Beat 4 — the preferences" lists the
    // substrate field each one needs (`columnKind()`/`isForwardCabin()` in
    // data/handling.ts, `fareBrand` on every option, `homeTimezone` on the
    // traveller, `status`/`delayMinutes`/`scheduleChangeMinutes` on the flight).
    //
    // The last sentence is the one that makes the beat VISIBLE. Without an
    // instruction to name the preference out loud in the summary's `note`, the
    // room watches a competent answer and has no way to know anything was
    // recalled.
    kind: "topical",
    scope: "user",
    content:
      "Camila Rojas's standing travel preferences. Seat her on the AISLE, " +
      "forward of the wing wherever there is a forward seat free. NEVER put her " +
      "in Basic Economy, even when it is the cheapest option on the board — say " +
      "plainly that you skipped it. Quote every departure and arrival in her " +
      "HOME time, America/Santiago, not the local airport clock, and say which " +
      "clock you are using. When you summarize her trips, lead with whatever is " +
      "DISRUPTED — cancelled first, then delayed or moved — before anything on " +
      "schedule. Apply all of this without being asked, and when you render the " +
      "trip summary put the preference you applied in the summary's note so she " +
      "can see it was remembered.",
  },
  {
    // ── BEAT 5 ──────────────────────────────────────────────────────────────
    // A PROCEDURE, so recall produces visible ACTION — three tool calls in a row,
    // each changing something on the trip record — rather than a reformatted
    // answer. The parenthetical disjointness clause is load-bearing: without it
    // the agent conflates this with beat 6 and starts offering to record a
    // procedure it already has.
    kind: "operational",
    // `user`, NOT `project` — banking scopes its equivalent procedure to
    // `project`, and that turned out to be the wrong model. Verified against the
    // running Intelligence stack: a project-scoped memory is returned for EVERY
    // user id in the instance, not just the ones in some project. Since all six
    // skins in this app point at one instance, a project-scoped procedure is
    // effectively global — Aeronova's cancellation procedure would surface inside
    // banking's demo and vice versa, each looking like the memory system had
    // confused two products.
    //
    // And it is what makes the presenter reset able to re-arm beat 6:
    // `forget-memories.ts` deliberately SKIPS project-scoped rows (they belong to
    // sibling skins sharing the backend), so anything saved at project scope
    // survives every reset. A project-scoped procedure here would mean the second
    // run of the demo opens with the agent already knowing it.
    scope: "user",
    content:
      "Procedure for when a flight is cancelled and the passenger asks you to " +
      "handle it, however vaguely they put it (this is NOT the procedure for a " +
      "ticket whose FARE refuses a change — those are different situations, do " +
      "not confuse them, and do not offer to record anything here): identify the " +
      "cancelled booking from the live context and use its BOOKING ID, never its " +
      "confirmation code, because one confirmation code can cover two legs. " +
      "Then (1) call rebookOntoOption on that booking id with the best option on " +
      "its board — a cancelled flight is Aeronova's fault so the change is " +
      "involuntary and free on any fare, and never pick a Basic Economy option, " +
      "(2) call reseatPassenger on the same booking id with the preference " +
      "'aisle' so she keeps her usual seat kind on the new itinerary, (3) call " +
      "notifyTripParty on the same booking id for the party 'arrival-pickup' " +
      "with the 'new-arrival-time' template so whoever is meeting her knows when " +
      "she now lands. Run all three immediately, in order, without asking for " +
      "confirmation between them, then confirm what you did in ONE short " +
      "sentence.",
  },
  // DO NOT seed a procedure for getting a change through on a ticket whose fare
  // refuses one. That is beat 6, and it is taught live. See rule 3 in the header.
];

/**
 * Write the seed memories for one identity; returns how many were stored.
 *
 * Never throws. A booth reset must still report success for the DATA store even
 * when the memory backend is unhappy — a presenter needs the trip record restored
 * far more urgently than they need a stack trace — so failures are counted and
 * logged, not propagated.
 */
export async function seedMemories(
  params: SeedMemoriesParams,
): Promise<number> {
  const { apiUrl, apiKey, userId, timeoutMs = DEFAULT_TIMEOUT_MS } = params;
  const base = apiUrl.replace(/\/$/, "");
  let stored = 0;

  for (const memory of SEED_MEMORIES) {
    try {
      const res = await fetch(`${base}/api/memories`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Cpki-User-Id": userId,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(memory),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) stored += 1;
      else
        console.error(`[airline/seed-memories] ${userId}: HTTP ${res.status}`);
    } catch (err) {
      console.error(`[airline/seed-memories] ${userId}: ${String(err)}`);
    }
  }

  return stored;
}
