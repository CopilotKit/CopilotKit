/**
 * BEATS 4 AND 5 — the memory Bellwether is supposed to start out already having.
 * Server-safe plain .ts. Called by `dev/reset` immediately after wiping learned
 * memory, so the demo is re-armed before the presenter says a word.
 *
 * "It already knows me" is a FILE, not emergent behaviour. Three rules govern
 * what belongs here:
 *
 *  1. Seed a standing PREFERENCE, not a fact. "Nadia's favourite category"
 *     proves storage. "Read the range by category, below-floor first, as margin
 *     percent rather than revenue" proves APPLIED learning, because recall
 *     visibly changes the answer to a question the user never re-explained.
 *
 *  2. The procedure must run FULLY AUTOMATICALLY. Banking's equivalent once
 *     opened a confirmation card mid-procedure; when a presenter moved on
 *     without answering it, that tool call sat unresolved and the NEXT message
 *     failed the whole thread with "Tool result is missing for tool call ...".
 *     A procedure with no half-finished state has nothing to leave behind, so
 *     "run all of them immediately, in order, without asking for confirmation"
 *     is written into the memory text itself, not just the prompt.
 *
 *  3. NEVER seed beat 6's procedure. The below-floor markdown approval is the
 *     one Bellwether has to be taught on stage. Seed it and the agent already
 *     knows the answer, never offers to record, and the entire teach arc
 *     disappears — which is exactly the kind of failure that still compiles and
 *     still looks fine right up until the demo. The beat-5 memory below says so
 *     explicitly so the two procedures can never be confused for one another.
 */

/**
 * Per-request timeout. A presenter reset seeds several buckets serially right
 * after sweeping five of them, all in one request — with no bound, one wedged
 * POST leaves the Reset button spinning forever. A timeout here fails the way
 * this function already fails: counted and logged, never thrown.
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
    // than adding a fact. Note it names three separate, checkable behaviours
    // (group by category / below-floor first / margin percent not revenue) — a
    // single-clause preference is too easy for the audience to read as a
    // coincidence.
    kind: "topical",
    scope: "user",
    content:
      "Nadia Okonjo reads trading by CATEGORY, never by vendor. She wants any " +
      "product sitting below its category margin floor called out FIRST, ahead " +
      "of everything else, and she reads a product's health as its GROSS " +
      "MARGIN PERCENT rather than as revenue or units. Apply this to every " +
      "margin summary without being asked, and say which preference you applied.",
  },
  {
    // ── BEAT 5 ──────────────────────────────────────────────────────────────
    // A PROCEDURE, so recall produces visible ACTION — three tool calls in a
    // row, each changing something on screen — rather than a reformatted
    // answer. The parenthetical disjointness clause is load-bearing: without it
    // the agent conflates this with beat 6 and starts offering to record a
    // procedure it already has.
    kind: "operational",
    // `user`, NOT `project` — banking scopes its equivalent procedure to
    // `project`, and that turned out to be the wrong model here. Verified
    // against the running Intelligence stack: a project-scoped memory is
    // returned for EVERY user id in the instance, not just the ones in some
    // project. Since EVERY skin in this app points at one instance, a
    // project-scoped procedure is effectively global — Bellwether's fraud
    // procedure would surface inside banking's demo and vice versa, each looking
    // like the memory system had confused two products. User scope is
    // partitioned correctly, and Bellwether's memories belong to one operator
    // anyway (see intelligence/user-id.ts).
    scope: "user",
    content:
      "Procedure for when an order is suspected of fraud or looks wrong (this " +
      "is NOT the procedure for approving a markdown that breaks the margin " +
      "floor — they are different situations, do not confuse them, and do not " +
      "offer to record anything here): (1) call holdOrder on that order with " +
      "the reason 'fraud-review' so fulfillment stops, (2) call notifyCustomer " +
      "with the 'verification-required' template so the customer is asked to " +
      "confirm the purchase, (3) call postOrderNote with one short line saying " +
      "what was held and why. Run all three immediately, in order, without " +
      "asking for confirmation, then confirm what was done in one short sentence.",
  },
  // DO NOT seed the below-floor markdown approval procedure. That is beat 6, and
  // it is taught live. See rule 3 in the header.
];

/**
 * Write the seed memories for one identity; returns how many were stored.
 *
 * Never throws. A booth reset must still report success for the DATA store even
 * when the memory backend is unhappy — a presenter needs the order book restored
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
        console.error(`[commerce/seed-memories] ${userId}: HTTP ${res.status}`);
    } catch (err) {
      console.error(`[commerce/seed-memories] ${userId}: ${String(err)}`);
    }
  }

  return stored;
}
