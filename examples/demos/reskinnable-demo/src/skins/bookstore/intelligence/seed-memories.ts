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
 * Deliberately NOT seeded: the beat-6 teach-a-new-procedure workflow. That
 * beat alone is deferred to phase 2 (spec §13); seeding it now would leave
 * the agent offering to run something no tool implements. Beat 5's
 * procedure (below) IS seeded — it is recalled, not taught.
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
  {
    kind: "operational",
    // scope: "user", NOT "project" — a project-scoped memory is returned for
    // EVERY user id on the shared Intelligence instance, so a project-scoped
    // procedure would surface inside the other skins' demos and read as the
    // memory system confusing two products. `./forget-memories.ts` skips
    // project rows for the same reason; its header has the fuller writeup —
    // this comment matches that reasoning rather than re-deriving it.
    scope: "user",
    // Beat 5: the shopper recalls a standing procedure rather than restating
    // it. Verbatim from the plan so the tool names and their order are exact —
    // the agent must call these tools literally and in this sequence, and must
    // never treat this recall as a request to learn or record a new workflow.
    content:
      "Procedure for setting up the shopper's book club order (this is NOT a " +
      "request to learn or record anything — do not offer to record a " +
      "workflow): (1) read the book club context for this month's pick, the " +
      "club's code and the next meeting date, (2) call addToCart with the " +
      "pick's HARDCOVER book id, (3) call swapEdition from that hardcover id " +
      "to the pick's PAPERBACK id, because the club reads paperback, (4) call " +
      "applyPromoCode with the club's code, and (5) call setDeliveryBy with " +
      "the next meeting date. Run all of them immediately, in order, without " +
      "asking for confirmation, then confirm in one short sentence naming the " +
      "book, the code and the new total in bold. Do NOT use addToWishlist, " +
      "setReminder or applyStoreCredit here — none of them is part of this " +
      "procedure.",
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
