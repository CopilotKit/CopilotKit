/**
 * Seed the durable memory the demo is expected to ALREADY hold.
 *
 * "It remembers me" is a FILE, not emergent behaviour. The demo starts with one
 * topical preference already stored, so the presenter clicks the recommendation
 * pill and the agent applies a taste nobody typed and names it in the answer.
 * THAT is the beat. Reset must re-seed this, or the second run of the demo
 * silently degrades to a generic answer.
 *
 * ⚠ The preference is written to EVERY bucket a run can resolve to, not just
 * Maya's — `dev/reset` iterates `bookstoreMemorySeedTargetUserIds()`. Guest's
 * bucket is left empty because nothing needs to be written to it, NOT because
 * switching to Guest demonstrates per-shopper isolation: switching does not
 * re-scope memory at all. See the caveat in `./user-id.ts`.
 *
 * The preference is a FORMAT/TASTE preference rather than a fact, because a fact
 * ("her favourite book is X") only proves storage, while a preference visibly
 * CHANGES the answer — which is what an audience can see. The seed catalog is
 * built so this preference excludes real books: three hardcovers and four
 * over-$20 titles sit on the literary and translated shelves, enforced by
 * data/seed.test.ts.
 *
 * Deliberately NOT seeded: any multi-step procedure. Beats 5 and 6 are deferred
 * to phase 2 (spec §13), and seeding a procedure now would leave the agent
 * offering to run something no tool implements.
 *
 * SERVER-SAFE: no "use client", no JSX, no React.
 */

export interface SeedMemoriesParams {
  apiUrl: string;
  apiKey: string;
  userId: string;
}

/** One durable fact the demo should start already knowing. */
interface SeedMemory {
  kind: "topical" | "episodic" | "operational";
  scope: "user" | "project";
  content: string;
}

/**
 * Maya's memories. Scoped `user` rather than `project` so they belong to an
 * identity and not to the whole instance — a `scope: "project"` row comes back
 * for EVERY user id on this backend, which several skins share locally, so
 * project scope would leak this preference into the sibling demos' answers.
 */
export const SEED_MEMORIES: readonly SeedMemory[] = Object.freeze([
  {
    kind: "topical",
    scope: "user",
    // Phrased as a standing instruction so recall visibly changes the answer: she
    // asks a plain question and gets her own constraints applied without having
    // stated them. Every clause is checkable against the cards on screen, which
    // is what makes the beat land rather than merely happen.
    content:
      "Maya reads literary fiction and translated fiction. She buys paperback " +
      "or ebook only — never hardcover. She caps a single book at $20. She " +
      "wants one line on why each book was picked, and she likes knowing the " +
      "translator's name.",
  },
]);

/**
 * Write the seed memories for one identity. Returns how many were stored.
 * Never throws: a booth reset must still report success for the rest of the
 * reset even if the memory backend is unhappy, so failures are counted and
 * logged rather than propagated.
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
          `[bookstore seed-memories] ${userId}: HTTP ${res.status} storing seed memory`,
        );
    } catch (err) {
      console.error(`[bookstore seed-memories] ${userId}: ${String(err)}`);
    }
  }

  return stored;
}
