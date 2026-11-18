/**
 * BEATS 4 AND 5 — the memory Vantage is supposed to start out already having.
 * Server-safe plain .ts. Called by `dev/reset` immediately after wiping learned
 * memory, so the demo is re-armed before the presenter says a word.
 *
 * "It already knows me" is a FILE, not emergent behaviour. Three rules govern
 * what belongs here:
 *
 *  1. Seed a standing PREFERENCE, not a fact. "Cascade's favourite metric" proves
 *     storage. "Growth is presented QoQ, not YoY, and EBITDA rides next to
 *     revenue in the headline" proves APPLIED learning, because recall visibly
 *     changes the shape of a block the user never re-specified.
 *
 *  2. The procedure must run FULLY AUTOMATICALLY. Banking's equivalent once
 *     opened a confirmation card mid-procedure; when a presenter moved on
 *     without answering it, that tool call sat unresolved and the NEXT message
 *     failed the whole thread with "Tool result is missing for tool call ...".
 *     A procedure with no half-finished state has nothing to leave behind, so
 *     "without pausing for confirmation between steps" is written into the
 *     memory text itself, not just the prompt.
 *
 *     But NOT "run all steps immediately", which is how this was first worded:
 *     that reads as "emit every step in one turn" and contradicts prompt rule 4
 *     in `../agent.ts` — ONE BLOCK AT A TIME, because two render calls in the
 *     same turn collide on the surface they are drawn onto and the second
 *     REPLACES the first. Recall is the very thing beat 5 is showing off, so
 *     the agent follows the memory and the room watches three blocks become
 *     one. The seeded text therefore says "in order, one tool call per turn"
 *     AND "without pausing for confirmation": stepwise and unblocking are two
 *     separate requirements, and the memory has to state both.
 *
 *  3. NEVER seed beat 6's procedure. The publish-unlock — filing a variance
 *     narrative under a justifying code to clear the 422 `UNEXPLAINED_VARIANCE`
 *     gate — is the one that has to be taught on stage. Seed it and the agent
 *     already knows the answer, never offers to record, and the entire teach
 *     arc disappears — which is exactly the kind of failure that still
 *     compiles and still looks fine right up until the demo. The beat-5 memory
 *     below says so explicitly so the two procedures can never be confused for
 *     one another.
 */

import { redactSecrets } from "@/lib/redact-secrets";

/**
 * Per-request timeout, matching keel/commerce/airline/logistics' seed helpers.
 * Several buckets are seeded SERIALLY on a presenter reset, so an unbounded
 * `fetch` means the Reset button spins forever against a wedged backend — the
 * one moment a presenter has no time to debug anything. An aborted POST is
 * counted as not-stored, which `dev/reset`'s seed-shortfall check then reports.
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
  /**
   * `"user"` ONLY — `"project"` is deliberately not a member of this type,
   * not just an unused option. `forget-memories.ts` NEVER deletes
   * `scope: "project"` rows (they are global to the backend instance, shared
   * with every other skin), so a project-scoped seed here would survive
   * every presenter reset forever: exactly the "beat 6 starts out already
   * taught" failure the reset exists to prevent (see the header's rule 3 and
   * `dev/reset`'s doc comment). Widening this back to `"user" | "project"`
   * would silently reopen that hole the next time someone adds a memory here.
   */
  scope: "user";
  content: string;
}

export const SEED_MEMORIES: readonly SeedMemory[] = [
  {
    // ── BEAT 4 ──────────────────────────────────────────────────────────────
    // A standing preference about SHAPE, so recall changes the answer rather
    // than adding a fact. It names two separate, checkable behaviours (QoQ
    // over YoY / EBITDA in the headline) — a single-clause preference is too
    // easy for the audience to read as a coincidence.
    kind: "topical",
    // `user`, NOT `project` — see the beat-5 memory's comment below for why
    // this skin scopes both memories to the individual rather than sharing
    // them instance-wide.
    scope: "user",
    content:
      "When composing metric blocks for Cascade executives: growth is " +
      "presented QoQ (not YoY), and EBITDA appears in the headline next to " +
      "revenue. Apply this without being asked and say you did.",
  },
  {
    // ── BEAT 5 ──────────────────────────────────────────────────────────────
    // A PROCEDURE, so recall produces visible ACTION — six tool calls in a
    // row (three renders, then three pins), each changing something on screen
    // — rather than a reformatted answer. Step 4 names
    // `pinBlockToDashboard` explicitly because it IS executable: the agent's
    // half of the block's "Add to dashboard" control (`../tools.tsx`), taking
    // the `blockId` each `render_metric_block` call returns. A step the agent
    // can only narrate is a step the room watches not happen.
    // The parenthetical disjointness clause is load-bearing: without
    // it the agent conflates this with beat 6 and starts offering to file a
    // variance narrative it already knows how to do.
    kind: "operational",
    // `user`, NOT `project` — banking scopes its equivalent procedure to
    // `project`, and that turned out to be the wrong model here. Verified
    // against the running Intelligence stack: a project-scoped memory is
    // returned for EVERY user id in the instance, not just the ones in some
    // project. Since all skins in this app point at one instance, a
    // project-scoped procedure is effectively global — Vantage's board-pack
    // procedure would surface inside another skin's demo and vice versa, each
    // looking like the memory system had confused two products. User scope is
    // partitioned correctly.
    scope: "user",
    content:
      "Month-end board pack assembly (this is NOT the publish-unlock " +
      "procedure — filing a variance narrative to clear a publish refusal is " +
      "a different situation, do not confuse them, and do not offer to record " +
      "anything here): (1) render a revenue-vs-plan metric tile for the " +
      "latest closed month, (2) render an opex variance bar, (3) render the " +
      "initiative table, (4) pin all three to the CEO dashboard, using " +
      "pinBlockToDashboard with each rendered block's id. Work through the " +
      "steps in order, one tool call per turn — never two render calls in the " +
      "same turn — starting immediately and without pausing for confirmation " +
      "between steps, then confirm what was done in one short sentence.",
  },
  // DO NOT seed the publish-unlock procedure. That is beat 6, and it must be
  // teachable on stage. See rule 3 in the header.
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
      if (res.ok) {
        stored += 1;
      } else {
        // The BODY, not just the status. `dev/reset` reports a seed shortfall
        // as a count, so this log line is the only place the reason survives —
        // and `422` alone does not say WHICH field the backend rejected, while
        // `422 MEMORY_VALIDATION_ERROR: kind must be one of …` names it. That
        // is the difference between fixing this file and guessing at it while
        // beats 4/5 stay unarmed.
        console.error(
          `[exec/seed-memories] ${userId}: HTTP ${res.status} ${await safeText(res)}`,
        );
      }
    } catch (err) {
      console.error(`[exec/seed-memories] ${userId}: ${describeError(err)}`);
    }
  }

  return stored;
}

/**
 * Body text for a log line: never throws, never floods, never echoes a secret.
 *
 * REDACTED even though this is a server LOG rather than a response body — the
 * usual rule (see `src/lib/redact-secrets.ts`) is that logs keep their secrets
 * because a human debugging a reset needs to see which backend was touched.
 * This text is different in kind: it is UNTRUSTED bytes composed upstream, and
 * a backend that quotes the rejected request back at us echoes the
 * `Authorization` header's key into wherever these logs are shipped. The
 * address and status this line already carries are what the debugging needs;
 * the credential is not.
 */
async function safeText(res: Response): Promise<string> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return "<unreadable body>";
  }
  const redacted = redactSecrets(text);
  return redacted.length > 400 ? `${redacted.slice(0, 400)}…` : redacted;
}

function describeError(err: unknown): string {
  const described =
    err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return redactSecrets(described);
}
