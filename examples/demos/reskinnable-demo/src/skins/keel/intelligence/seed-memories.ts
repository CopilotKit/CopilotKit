/**
 * BEATS 4 AND 5 — the memory Keel is supposed to start out already having.
 * Server-safe plain .ts. Called by `dev/reset` immediately after wiping learned
 * memory, so the demo is re-armed before the presenter says a word.
 *
 * "It already knows me" is a FILE, not emergent behaviour. Four rules govern what
 * belongs here — the first three are general, the fourth is specific to this skin:
 *
 *  1. Seed a standing PREFERENCE, not a fact. "The desk's favourite policy"
 *     proves storage. "Group the register by knowledge space, overdue first,
 *     coverage as a whole percent" proves APPLIED learning, because recall
 *     visibly changes the answer to a question nobody re-explained.
 *
 *  2. The procedure must run FULLY AUTOMATICALLY. Banking's equivalent once
 *     opened a confirmation card mid-procedure; when a presenter moved on without
 *     answering it, that tool call sat unresolved and the NEXT message failed the
 *     whole thread with "Tool result is missing for tool call ...". A procedure
 *     with no half-finished state has nothing to leave behind, so "run all of them
 *     immediately, in order, without asking for confirmation" is written into the
 *     memory TEXT, not only into the prompt.
 *
 *  3. NEVER seed beat 6's procedure. See the explicit note at the end of
 *     `SEED_MEMORIES`.
 *
 *  4. THE TEXT IS ADDRESSED TO THE DESK, NEVER TO A NAMED PERSON. These memories
 *     are seeded into the default bucket AND every mapped persona's bucket (see
 *     `memorySeedTargetUserIds` in ./user-id.ts, which says why), and keel's role
 *     switcher sits in the header where a presenter will use it. A preference
 *     phrased "when Sam asks for a summary…" would therefore be recalled while
 *     Ana Reyes is on screen and read as the memory system confusing two people.
 *     `data/beat-map.md` drafted beat 4's preference in the second person about
 *     Sam; the four CHECKABLE behaviours it specifies are reproduced exactly, the
 *     addressee is not.
 */

/**
 * Per-request timeout. A presenter reset seeds several buckets serially right
 * after sweeping nine of them, all in one request — with no bound, one wedged POST
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
    // than adding a fact. It names FOUR separate, checkable behaviours —
    // grouping, overdue-first ordering, whole-percent coverage, owner beside the
    // ref — because a single-clause preference is too easy for a room to read as
    // a coincidence.
    //
    // The last clause is the HONESTY clause and it is real rather than
    // decorative: a document nobody has been assigned has UNKNOWN attestation
    // coverage, not 0% (`data/attention.ts` models it as a tri-state), so obeying
    // the preference and telling the truth are the same code path.
    kind: "topical",
    scope: "user",
    content:
      "The Harbor Point knowledge and operations desk reads the policy register " +
      "the same way every week. Group any summary of the register by KNOWLEDGE " +
      "SPACE — Privacy, Clinical, Vendor — and lead each group with the " +
      "documents past their review date, ahead of everything else. Give " +
      "attestation coverage as a WHOLE PERCENT, never a fraction or a ratio, and " +
      "name the owning department beside every document reference. When a " +
      "document's attestation coverage is not measurable, say that plainly " +
      "rather than printing 0%. Apply this to every register summary without " +
      "being asked, and say which preference you applied.",
  },
  {
    // ── BEAT 5 ──────────────────────────────────────────────────────────────
    // A PROCEDURE, so recall produces visible ACTION — three writes in a row,
    // each changing something on the document record — rather than a reformatted
    // answer. All three land on the ONE record, so the register row and the
    // document page paint them with no new read path.
    //
    // The parenthetical disjointness clause is load-bearing: without it the agent
    // conflates this with beat 6 and starts offering to record a procedure it
    // already has. `data/handling.ts` keeps the two vocabularies in separate
    // modules for the same reason, and shares no token between them.
    kind: "operational",
    // `user`, NOT `project`. Banking scopes its equivalent procedure to `project`
    // and `demo-beats.md` still describes it that way; both are out of date for
    // this app. Verified against the running Intelligence stack: a project-scoped
    // row is returned for EVERY user id in the instance, not partitioned per
    // product — and `forget-memories.ts` therefore SKIPS project-scoped rows so a
    // keel reset cannot destroy banking's seeded memories. A project-scoped
    // procedure would consequently survive every presenter reset, so beat 6 would
    // open already taught: the agent would never decline, never offer to record,
    // and the beat would silently prove nothing.
    scope: "user",
    content:
      "Procedure for when a policy document is out of date, stale, needs " +
      "chasing, or the desk simply says to handle it (this is NOT the procedure " +
      "for getting a revision released when an endorsing body has not signed it " +
      "— they are different situations, do not confuse them, and do not offer to " +
      "record anything here): (1) call raiseReviewFlag on that document with the " +
      "reason 'review-overdue' so it joins the desk's review list, (2) call " +
      "sendOwnerNotice on the same document with the 'review-due' template so " +
      "the owning department is asked to confirm or revise it, (3) call " +
      "addDocumentNote on the same document with one short line saying what was " +
      "flagged and why. Run all three immediately, in order, without asking for " +
      "confirmation, then confirm what was done in one short sentence.",
  },
  // ⚠️ DO NOT SEED BEAT 6's PROCEDURE — the publication-variance path that gets
  // an unendorsed revision released. THE OMISSION IS DELIBERATE. That is the one
  // procedure Keel has to be taught on stage: seed it and the agent already knows
  // the answer, files the right code first time, never offers to record, and the
  // entire teach arc disappears — which is exactly the kind of failure that still
  // compiles, still lints and still looks fine right up until the demo. The
  // beat-5 memory above says so in its own text so the two can never be confused
  // for one another. See `data/variance-codes.ts` for the withheld catalogue.
];

/**
 * Write the seed memories for one identity; returns how many were stored.
 *
 * Never throws. A booth reset must still report success for the DATA store even
 * when the memory backend is unhappy — a presenter needs the register restored
 * far more urgently than they need a stack trace — so failures are counted and
 * logged, not propagated. The caller COMPARES the count against
 * `seedTargets.length * SEED_MEMORIES.length` rather than trusting that this
 * returned at all; see `src/app/api/keel/v1/dev/reset/route.ts`.
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
      else console.error(`[keel/seed-memories] ${userId}: HTTP ${res.status}`);
    } catch (err) {
      console.error(`[keel/seed-memories] ${userId}: ${String(err)}`);
    }
  }

  return stored;
}
