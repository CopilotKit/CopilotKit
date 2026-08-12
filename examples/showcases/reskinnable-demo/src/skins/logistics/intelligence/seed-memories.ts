/**
 * BEATS 4 AND 5 — the memory Meridian is supposed to start out already having.
 * Server-safe plain .ts. Called by `dev/reset` immediately after wiping learned
 * memory, so the demo is re-armed before the presenter says a word.
 *
 * "It already knows me" is a FILE, not emergent behaviour. Three rules govern
 * what belongs here:
 *
 *  1. Seed a standing PREFERENCE, not a fact. "Rosa's busiest lane" proves
 *     storage. "Read the queue by lane, anything past its promised date first,
 *     exposure in whole thousands" proves APPLIED learning, because recall
 *     visibly changes the answer to a question nobody re-explained.
 *
 *  2. The procedure must run FULLY AUTOMATICALLY. Banking's equivalent once
 *     opened a confirmation card mid-procedure; when a presenter moved on
 *     without answering it, that tool call sat unresolved and the NEXT message
 *     failed the whole thread with "Tool result is missing for tool call ...".
 *     A procedure with no half-finished state has nothing to leave behind, so
 *     "run all of them immediately, in order, without asking for confirmation"
 *     is written into the memory text itself, not just the prompt. All three
 *     tools it names are `useFrontendTool`, never `useHumanInTheLoop`.
 *
 *  3. NEVER seed beat 6's procedure. Getting an OVER-AUTHORITY mitigation past
 *     the approval limit is the one Meridian has to be taught on stage: the
 *     refusal names the problem and never the fix, and the vocabulary that lifts
 *     the gate (`data/escalation-codes.ts`) is withheld from the agent
 *     everywhere — the readables, the tool schemas, the prompt and the 422 body.
 *     Seeding it here would hand the answer over through the one channel none of
 *     those guards watch, the agent would never offer to record, and the whole
 *     teach arc would disappear. That failure still compiles, still renders, and
 *     is discovered on stage. The beat-5 memory below says so in its own text so
 *     the two procedures can never be confused for one another.
 */

/**
 * Per-request timeout. A presenter reset seeds several buckets serially right
 * after sweeping them, all in one request — with no bound, one wedged POST
 * leaves the Reset button spinning forever. A timeout here fails the way this
 * function already fails: counted and logged, never thrown.
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
    // A standing preference about SHAPE, so recall changes the answer rather
    // than adding a fact. Three separate, checkable behaviours (group by lane /
    // past-promise first / whole thousands) — a single-clause preference is too
    // easy for the audience to read as a coincidence, and each of the three maps
    // to one flag on `showExceptionSummary`.
    kind: "topical",
    scope: "user",
    content:
      "Rosa Delgado reads the exception queue by LANE, never by carrier. She " +
      "wants any shipment that is already past the date promised to the " +
      "customer called out FIRST, ahead of everything else, and she reads " +
      "exposure ROUNDED TO WHOLE THOUSANDS of dollars rather than to the " +
      "dollar. Apply this to every exception summary without being asked, and " +
      "say which preference you applied.",
  },
  {
    // ── BEAT 5 ──────────────────────────────────────────────────────────────
    // A PROCEDURE, so recall produces visible ACTION — three tool calls in a
    // row, each changing something on the Control Tower board — rather than a
    // reformatted answer. The parenthetical disjointness clause is load-bearing:
    // without it the agent conflates this with beat 6 and starts offering to
    // record a procedure it already has.
    kind: "operational",
    // `user`, NOT `project`. Banking scopes its equivalent procedure to
    // `project`, and that is the wrong model here: verified against the running
    // Intelligence stack, a project-scoped memory is returned for EVERY user id
    // in the instance rather than for some project. All six skins in this app
    // point at one instance, so a project-scoped procedure is effectively
    // global — Meridian's carrier procedure would surface inside banking's demo
    // and vice versa, each looking like the memory system had confused two
    // products. It is also what keeps this memory DISTINGUISHABLE from beat 6's
    // learned one at the scope level, not merely by wording.
    scope: "user",
    content:
      "Procedure for when a carrier has gone quiet or dark on a shipment, or a " +
      "shipment is stuck and the planner asks you to handle it (this is NOT " +
      "the procedure for getting a mitigation past the planner's approval " +
      "authority — they are different situations, do not confuse them, and do " +
      "not offer to record anything here): (1) call raiseShipmentWatch on that " +
      "shipment with the reason 'carrier-silent' so it is flagged on the " +
      "Control Tower board, (2) call notifyCarrier with the 'recovery-plan' " +
      "message so the carrier is asked for a written recovery plan, (3) call " +
      "postShipmentNote with one short line saying what was flagged and why. " +
      "Run all three immediately, in order, without asking for confirmation, " +
      "then confirm what was done in one short sentence.",
  },
  // DO NOT seed the over-authority procedure. That is beat 6, and it is taught
  // live. See rule 3 in the header.
];

/**
 * Write the seed memories for one identity; returns how many were stored.
 *
 * Never throws. A booth reset must still report success for the DATA store even
 * when the memory backend is unhappy — a presenter needs the network restored
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
        console.error(
          `[logistics/seed-memories] ${userId}: HTTP ${res.status}`,
        );
    } catch (err) {
      console.error(`[logistics/seed-memories] ${userId}: ${String(err)}`);
    }
  }

  return stored;
}
