/**
 * BEATS 4 AND 5 — the memory Rowan is supposed to start out already having.
 * Server-safe plain .ts. Called by `dev/reset` immediately after wiping learned
 * memory, so the demo is re-armed before the presenter says a word.
 *
 * "It already knows me" is a FILE, not emergent behaviour. Three rules govern
 * what belongs here, each of them learned the hard way in the banking skin:
 *
 *  1. Seed a standing PREFERENCE, not a fact. "Maya's favourite team" proves
 *     storage. "Review comp by level, out-of-band first, as band position
 *     rather than raw salary" proves APPLIED learning, because recall visibly
 *     changes the answer to a question the user never re-explained.
 *
 *  2. The procedure must run FULLY AUTOMATICALLY. Banking's equivalent once
 *     opened a confirmation card mid-procedure; when a presenter moved on
 *     without answering it, that tool call sat unresolved and the NEXT message
 *     failed the whole thread with "Tool result is missing for tool call ...".
 *     A procedure with no half-finished state has nothing to leave behind, so
 *     "run all of them immediately, in order, without asking for confirmation"
 *     is written into the memory text itself, not just the prompt.
 *
 *  3. NEVER seed beat 6's procedure. The out-of-band approval is the one Rowan
 *     has to be taught on stage. Seed it and the agent already knows the
 *     answer, never offers to record, and the entire teach arc disappears —
 *     which is exactly the kind of failure that still compiles and still looks
 *     fine right up until the demo. The beat-5 memory below says so explicitly
 *     so the two procedures can never be confused for one another.
 */

export interface SeedMemoriesParams {
  apiUrl: string;
  apiKey: string;
  userId: string;
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
    // (group by level / out-of-band first / percentages not dollars) — a
    // single-clause preference is too easy for the audience to read as a
    // coincidence.
    kind: "topical",
    scope: "user",
    content:
      "Maya Lindqvist reviews compensation by LEVEL, never by team. She wants " +
      "anyone sitting outside their band called out FIRST, ahead of everything " +
      "else, and she reads a person's pay as their POSITION IN BAND as a " +
      "percentage rather than as a raw salary figure. Apply this to every " +
      "compensation summary without being asked, and say which preference you " +
      "applied.",
  },
  {
    // ── BEAT 5 ──────────────────────────────────────────────────────────────
    // A PROCEDURE, so recall produces visible ACTION — three tool calls in a
    // row, each changing something on screen — rather than a reformatted
    // answer. The parenthetical disjointness clause is load-bearing: without
    // it the agent conflates this with beat 6 and starts offering to record a
    // procedure it already has.
    kind: "operational",
    // `user`, NOT `project` — banking scopes its equivalent procedure to
    // `project`, and that turned out to be the wrong model here. Verified
    // against the running Intelligence stack: a project-scoped memory is
    // returned for EVERY user id in the instance, not just the ones in some
    // project. Since all five skins in this app point at one instance, a
    // project-scoped procedure is effectively global — Rowan's onboarding
    // procedure would surface inside banking's demo and vice versa, each
    // looking like the memory system had confused two products. User scope is
    // partitioned correctly, and Rowan's memories belong to one operator
    // anyway (see intelligence/user-id.ts).
    scope: "user",
    content:
      "Procedure for when a new hire is about to start (this is NOT the " +
      "procedure for an out-of-band compensation request — they are different " +
      "situations, do not confuse them, and do not offer to record anything " +
      "here): (1) call createOnboardingTasks for that person to build their " +
      "checklist, (2) call assignBuddy to pair them with an experienced " +
      "teammate on their own team who is not their manager, (3) call " +
      "postWelcomeNote with a short welcome naming their team and their buddy. " +
      "Run all three immediately, in order, without asking for confirmation, " +
      "then confirm what was done in one short sentence.",
  },
  // DO NOT seed the out-of-band approval procedure. That is beat 6, and it is
  // taught live. See rule 3 in the header.
];

/**
 * Write the seed memories for one identity; returns how many were stored.
 *
 * Never throws. A booth reset must still report success for the DATA store even
 * when the memory backend is unhappy — a presenter needs the roster restored
 * far more urgently than they need a stack trace — so failures are counted and
 * logged, not propagated.
 */
export async function seedMemories(
  params: SeedMemoriesParams,
): Promise<number> {
  const { apiUrl, apiKey, userId } = params;
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
      });
      if (res.ok) stored += 1;
      else
        console.error(`[people/seed-memories] ${userId}: HTTP ${res.status}`);
    } catch (err) {
      console.error(`[people/seed-memories] ${userId}: ${String(err)}`);
    }
  }

  return stored;
}
