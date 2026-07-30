/**
 * Seed the durable memory the demo is expected to ALREADY hold.
 *
 * The demo tells a two-part story about learning: first that the agent already
 * carries knowledge and applies it unprompted, then (via the over-limit AWS
 * charge) that it can be taught something new and keep it. The second half is
 * earned live on stage; the first half has to be true before the presenter says
 * a word, which means it must survive `POST /api/v1/dev/reset` — the reset
 * deletes every memory, so it re-seeds these immediately afterwards.
 *
 * These are written to the SAME identity the runtime asserts for the default
 * demo user, so the agent's own recall_memory finds them.
 *
 * Deliberately NOT seeded: the over-limit / policy-exception procedure. That one
 * is the payload of the teach-and-save arc; pre-seeding it would defeat the
 * whole demo (the agent would already know the answer and never offer to
 * record).
 */

export interface SeedMemoriesParams {
  apiUrl: string;
  apiKey: string;
  userId: string;
}

/** One durable fact the agent should start every demo already knowing. */
interface SeedMemory {
  kind: "topical" | "episodic" | "operational";
  scope: "user" | "project";
  content: string;
}

export const SEED_MEMORIES: readonly SeedMemory[] = [
  {
    kind: "topical",
    scope: "user",
    // Phrased as a standing instruction so recall visibly CHANGES the answer:
    // the officer asks a plain question and gets their own format back without
    // having asked for it. A fact like "favorite food" proves storage; a format
    // preference proves applied learning, which is the point being made.
    content:
      "Alex prefers spend summaries grouped by team, with anything over its " +
      "policy limit called out first, and figures rounded to whole dollars.",
  },
  {
    kind: "topical",
    scope: "user",
    content:
      "Alex is the finance lead for Northwind and reviews spend weekly, so " +
      "summaries should lead with what changed since the last review.",
  },
  {
    // The "already knows a PROCEDURE" beat, as opposed to the preferences above.
    // Multi-step and operational, so recall produces visible ACTION (three tool
    // calls in a row) rather than just a reformatted answer.
    //
    // Deliberately about SUSPICIOUS charges, never about clearing an over-limit
    // charge: that second procedure is what the AWS beat teaches live, and
    // seeding it would mean the agent already knew the answer and never offered
    // to record — the teach arc would vanish. Keep these two disjoint.
    kind: "operational",
    scope: "project",
    // All three steps run without a confirmation gate. The note step used to
    // open an approval card; if the presenter moved to the next beat without
    // answering it, that tool call sat unresolved and the NEXT message failed
    // the whole thread with "Tool result is missing for tool call ...". A fully
    // automatic procedure has no half-finished state to leave behind.
    content:
      "Procedure for a charge the user reports as suspicious or unrecognized " +
      "(NOT for over-limit approvals): (1) flag the transaction for review with " +
      "the reason, (2) send a spend alert to the card the charge sits on, and " +
      "(3) add a note to that transaction recording what was reported. Run all " +
      "three immediately, in order, without asking for confirmation, then " +
      "confirm what was done in one short sentence.",
  },
];

/**
 * Write the seed memories for one identity. Returns how many were stored.
 * Never throws: a booth reset must still report success for the store even if
 * the memory backend is unhappy, so failures are counted, not propagated.
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
        console.error(
          `[seed-memories] ${userId}: HTTP ${res.status} storing seed memory`,
        );
    } catch (err) {
      console.error(`[seed-memories] ${userId}: ${String(err)}`);
    }
  }

  return stored;
}
