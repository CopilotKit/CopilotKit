import * as store from "@/skins/keel/data/store";
import { presenterResetEnabled } from "@/lib/presenter";
import { redactSecrets } from "@/lib/redact-secrets";
import { forgetAllMemories } from "@/skins/keel/intelligence/forget-memories";
import {
  SEED_MEMORIES,
  seedMemories,
} from "@/skins/keel/intelligence/seed-memories";
import {
  memoryScopeUserIds,
  memorySeedTargetUserIds,
} from "@/skins/keel/intelligence/user-id";

/**
 * How much of the beats 4/5 memory actually landed. Reported as a WORD, not
 * inferred by the caller from two numbers.
 *
 *  - `seeded`  — every expected memory is in every target bucket. The ONLY state
 *                in which this route may claim `reset: ["store", "memory"]`.
 *  - `partial` — some landed. Beats 4/5 may work, may not: `seedMemories` iterates
 *                `SEED_MEMORIES` in order and swallows per-row failures, so a
 *                shortfall says nothing about WHICH memory is missing. The beat-4
 *                preference and the beat-5 procedure are independent, so a
 *                presenter cannot reason "5 of 10 means only the last one is gone".
 *  - `failed`  — nothing landed. Beats 4 and 5 WILL fail on stage.
 */
type MemoryStatus = "seeded" | "partial" | "failed";

/**
 * Compare against the KNOWABLE expectation instead of reporting whatever happened.
 * The count is knowable because both factors are: `SEED_MEMORIES` is a fixed
 * literal and `memorySeedTargetUserIds()` is derived from `resolveKeelUserId`.
 *
 * `expected === 0` is deliberately `failed`, never a vacuous "seeded": zero
 * expected memories means either `SEED_MEMORIES` was emptied or the target-bucket
 * derivation returned nothing, and in both cases the memory beats are unarmed.
 */
function classifySeeding(seeded: number, expected: number): MemoryStatus {
  if (expected > 0 && seeded >= expected) return "seeded";
  return seeded > 0 ? "partial" : "failed";
}

/**
 * The verdict for a reset that THREW part-way through, from what was actually
 * measured before the throw.
 *
 * `"seeded"` is UNREACHABLE here by construction, and that is the point: the
 * sequence only earns that word by sweeping every bucket AND re-seeding every
 * target, and an exception proves at least one of those did not finish. So the only
 * question left is whether anything landed at all — answered by counters, not by a
 * proxy. `bucketsSwept` (not `forgot`) is what says the wipe did something: a
 * bucket that was legitimately EMPTY forgets zero rows, which is the normal state
 * of a second reset in a row.
 */
function classifyInterrupted(progress: {
  bucketsSwept: number;
  seeded: number;
}): Exclude<MemoryStatus, "seeded"> {
  return progress.bucketsSwept > 0 || progress.seeded > 0
    ? "partial"
    : "failed";
}

/**
 * WHY EVERY FREE-TEXT FIELD BELOW GOES THROUGH `redactSecrets`.
 *
 * This route's gate (`PRESENTER_RESET_ENABLED`, or any non-production env) is a
 * demo convenience, NOT an authorization boundary — a booth deployment that sets it
 * answers this POST for anyone who can reach the box. So the body must not name the
 * internal Intelligence backend or the credential that opens it, while
 * `console.warn`/`console.error` still do: a human debugging a reset needs to see
 * WHICH stack was about to be touched (this repo vendors several), and the sidebar
 * button already tells them to read the logs.
 *
 * Two body fields carry free text this route did not compose: `memoryError`'s
 * `cause` (an arbitrary `Error.message` — undici's own "Failed to parse URL from …"
 * names the address verbatim) and `forgetShortfalls`, whose reasons quote the
 * backend's own response body, and a 401 payload is exactly the response that
 * echoes the key it rejected. Both are redacted on the way OUT rather than at their
 * source, so the log keeps the unredacted text.
 *
 * Wrapped rather than passed to `.map` directly: `map` supplies (value, index,
 * array), so `map(redactSecrets)` would hand the INDEX to the optional needle
 * parameter.
 */
const redactText = (text: string) => redactSecrets(text);

/**
 * Presenter/booth reset — put the Harbor Point desk back to the state the demo
 * starts from.
 *
 * ── WHAT THIS RESTORES IN THE STORE, all of it easy to get wrong ────────────
 *   1. The register is rebuilt from the corpus with dates re-anchored to NOW, so
 *      POL-114 Rev D and POL-208 Rev C are unreleased and unendorsed again, and
 *      beat 3c's `review_overdue` lever still discriminates rather than having
 *      drifted into flagging everything.
 *   2. Beat 5's three writes are gone — the review flag, the owner notices and the
 *      🚨 note all live ON the document record, so rebuilding drops every one. A
 *      register that opened with last run's note already on POL-121 would make the
 *      stored procedure look like it ran before anyone asked.
 *   3. Variances and impact briefs are emptied. A surviving ratified variance would
 *      leave beat 6 already unlocked — the most demo-destroying form this bug takes,
 *      because everything still works and it just proves nothing.
 *   4. Runs are re-seeded to their four starting states.
 *
 * ── AND WHAT IT NOW DOES TO DURABLE MEMORY ──────────────────────────────────
 *   5. LEARNED memory is wiped in EVERY bucket this process's runtime can reach —
 *      which is why the id set is ASKED FOR (`memoryScopeUserIds()`) rather than
 *      written down here. Miss a bucket and beat 6 starts out already knowing the
 *      answer. Bellwether shipped a hardcoded list and it could not possibly be
 *      right: `playwright.config.ts` pins `INTELLIGENCE_USER_ID`, which collapses
 *      the whole set onto one bucket the list did not contain.
 *   6. The beats 4/5 memories are put BACK — ALL of them, in EVERY target bucket —
 *      so "it already knows me" works on a cold reset with no warm-up run. CHECKED
 *      rather than assumed: see `classifySeeding`.
 *   7. Beat 6's procedure is still NOT known. That falls out of (5) + (6) because
 *      `SEED_MEMORIES` deliberately omits it — see seed-memories.ts.
 *
 * That memory half USED TO BE ABSENT, and the route said so loudly because the
 * button looks identical either way: keel had no `intelligence/seed-memories.ts` or
 * `forget-memories.ts`, so a second run of beat 6 faced an agent that already knew
 * the answer. Both files now exist and this route is their only caller.
 *
 * Allowed when a booth deployment set PRESENTER_RESET_ENABLED, OR in any
 * non-production environment. Keeping this in agreement with the header button
 * matters: gate it more tightly than the button and a production booth shows a
 * Reset control that 403s.
 */
export const POST = async () => {
  if (!presenterResetEnabled() && process.env.NODE_ENV === "production") {
    return Response.json(
      { error: "FORBIDDEN", message: "Not available in production." },
      { status: 403 },
    );
  }

  store.reset();

  const apiUrl = process.env.INTELLIGENCE_API_URL;
  const apiKey = process.env.INTELLIGENCE_API_KEY;
  if (!apiUrl || !apiKey) {
    // OSS path: there is no durable memory to clear, and beats 2/4/5/6 degrade by
    // design. Report exactly what was reset rather than implying more — listing
    // "memory" here would be the single most misleading string this route could
    // return, because a presenter reading it stops looking for the reason beat 6
    // opened already taught.
    return Response.json({ ok: true, reset: ["store"] });
  }

  // Declared outside the try so the catch can report PARTIAL progress: a mid-loop
  // failure can leave the store reset and some identities already forgotten, and an
  // error body reading "memory untouched" would send a presenter looking in the
  // wrong place.
  let forgot = 0;
  let seeded = 0;
  /**
   * How many buckets/targets each loop got THROUGH — the only figures that
   * distinguish "the sweep never ran" from "the sweep ran and the buckets were
   * legitimately empty", which `forgot`/`seeded` alone cannot: both are 0 in both
   * cases. Only the catch path reports them.
   */
  let bucketsSwept = 0;
  let bucketsSeeded = 0;
  /** Rows already absent when the DELETE landed. Success, but kept out of `forgot`. */
  let alreadyGone = 0;
  /**
   * Buckets whose sweep could NOT prove it left nothing deletable behind, with the
   * reason. An unfinished wipe matters as much as a short seed and for the same
   * reason: a memory the wipe missed is a memory the demo starts out already
   * knowing, so beat 6 can appear to have been taught before anyone taught it.
   */
  const forgetShortfalls: string[] = [];
  /** Individual rows that failed to delete, across all buckets. */
  let forgetFailures = 0;
  // Project-scoped rows the forget helper deliberately left alone — they belong to
  // sibling demos sharing this backend, not to keel. Reported rather than hidden: a
  // non-zero count after a keel-only session means something saved project-scoped
  // despite the prompt, which is the one way beat 6 could start out already taught.
  let skippedProjectScoped = 0;

  // ASKED, never restated. See point (5) in the header.
  const userIds = memoryScopeUserIds();
  const seedTargets = memorySeedTargetUserIds();
  // Name the backend and the exact ids BEFORE mutating. Several demos in this repo
  // vendor the same Intelligence stack, so if this process ever resolved a
  // neighbour's apiUrl, this line is where a human sees the reset was about to
  // reach into someone else's memory. It also makes the pinned-env collapse
  // VISIBLE: one id in this line means the deploy is pinned.
  //
  // THE LOG IS THE ONLY PLACE THE ADDRESS APPEARS. Do not echo `apiUrl` in a
  // response body: that hands the internal backend's address to anyone who can
  // reach a booth deployment that set PRESENTER_RESET_ENABLED.
  console.warn(
    `[keel] presenter reset: forgetting memories at ${apiUrl} for ${userIds.join(", ")}`,
  );

  try {
    for (const userId of userIds) {
      const result = await forgetAllMemories({ apiUrl, apiKey, userId });
      forgot += result.forgot;
      alreadyGone += result.alreadyGone;
      forgetFailures += result.failed.length;
      if (!result.complete) {
        forgetShortfalls.push(
          `${userId}: ${result.incompleteReason ?? "sweep did not prove it was empty"}`,
        );
      }
      // MAX, not a sum: the bare list returns every `scope: "project"` row for ANY
      // user id (see forget-memories.ts), so each bucket re-sees the same global
      // rows and summing would report N× the truth.
      skippedProjectScoped = Math.max(
        skippedProjectScoped,
        result.skippedProjectScoped,
      );
      bucketsSwept += 1;
    }
    // Seed EVERY target bucket — see `memorySeedTargetUserIds`. Runs frequently
    // resolve to the DEFAULT identity, so seeding only the mapped persona leaves
    // recall looking at an empty bucket and beats 4/5 fail silently.
    for (const userId of seedTargets) {
      seeded += await seedMemories({ apiUrl, apiKey, userId });
      bucketsSeeded += 1;
    }

    // `seedMemories` NEVER throws — it counts stored rows and logs the rest — so
    // reaching this line proves nothing about whether memory was written. The
    // expected count is knowable, so it is COMPARED rather than reported.
    const expectedSeeds = seedTargets.length * SEED_MEMORIES.length;
    const seedVerdict = classifySeeding(seeded, expectedSeeds);
    // The WIPE half of the same question. `forgetAllMemories` sets
    // `complete: false` when no list pass proved the bucket empty, and it steps
    // over individual delete failures rather than abandoning the remaining buckets
    // — so "it returned" does not imply "it finished".
    const wipeIncomplete = forgetShortfalls.length > 0;
    const memory = wipeIncomplete ? "partial" : seedVerdict;

    if (memory !== "seeded") {
      // 502 for BOTH partial and total, deliberately. The failing dependency is the
      // upstream memory API either way and the difference is degree, which belongs
      // in the body; and the only caller — the header Reset button in
      // `components/presenter-reset-button.tsx` — branches solely on `res.ok`, so a
      // partial seed must alert exactly as loudly as a total one. A 200 here would
      // navigate the presenter to a clean-looking app whose memory beats are
      // quietly broken.
      console.error(
        `[keel] presenter reset: seeded ${seeded}/${expectedSeeds} memories (${memory})` +
          (wipeIncomplete
            ? `; wipe incomplete — ${forgetShortfalls.join(" | ")}`
            : ""),
      );
      return Response.json(
        {
          ok: false,
          // NOT ["store", "memory"]: memory is only "reset" once it is wiped AND
          // fully re-seeded. The wipe on its own leaves the demo unarmed.
          reset: ["store"],
          memory,
          forgot,
          alreadyGone,
          forgetFailures,
          forgetShortfalls: forgetShortfalls.map(redactText),
          seeded,
          expectedSeeds,
          skippedProjectScoped,
          memoryError: wipeIncomplete
            ? // Named FIRST when both halves fell short: a memory the wipe missed
              // is worse than a memory the seed missed. A short seed leaves a beat
              // unarmed and visibly quiet; a surviving row leaves the demo already
              // knowing something, which reads as success and proves nothing.
              `memory wipe did not finish (${forgetShortfalls.length} of ${userIds.length} bucket(s), ${forgetFailures} row(s) failed to delete); a surviving memory can leave beat 6 already taught`
            : `seeded ${seeded} of ${expectedSeeds} expected memories across ${seedTargets.length} bucket(s); beats 4/5 are not armed`,
        },
        { status: 502 },
      );
    }

    return Response.json({
      ok: true,
      reset: ["store", "memory"],
      memory,
      forgot,
      alreadyGone,
      seeded,
      expectedSeeds,
      skippedProjectScoped,
    });
  } catch (err) {
    // ── THE INTERRUPTED PATH ────────────────────────────────────────────────
    // Reached when a bucket cannot be ENUMERATED (`forgetAllMemories` throws rather
    // than guess at a list it never got) or anything else in the sequence throws.
    // Nobody exercises this path until it fires at a booth, so it reports the same
    // MEASURED figures as the shortfall response above instead of inferring memory
    // state from one number.
    //
    // `reset` is always `["store"]` here: `store.reset()` ran before the try, and
    // memory only counts as reset once it was wiped AND fully re-seeded, which an
    // exception rules out.
    const expectedSeeds = seedTargets.length * SEED_MEMORIES.length;
    const memory = classifyInterrupted({ bucketsSwept, seeded });
    const cause = err instanceof Error ? err.message : String(err);
    // Name the phase from the counters rather than from a flag some future edit can
    // forget to move: the seed loop cannot start until the sweep loop is done.
    const phase = bucketsSwept < userIds.length ? "wipe" : "seed";
    const detail =
      `interrupted during the ${phase} phase — swept ${bucketsSwept}/${userIds.length} ` +
      `bucket(s), seeded ${seeded}/${expectedSeeds} memories across ` +
      `${bucketsSeeded}/${seedTargets.length} bucket(s): ${cause}` +
      (forgetShortfalls.length > 0
        ? `; ${forgetShortfalls.length} swept bucket(s) also could not prove they ` +
          `were emptied, so a surviving memory may leave beat 6 already taught`
        : "");
    // Logged UNREDACTED — this is the copy a human debugging the reset reads, and
    // `redactSecrets` exists to keep the Intelligence secrets out of the RESPONSE.
    console.error(`[keel] presenter reset: ${detail}`);
    return Response.json(
      {
        ok: false,
        reset: ["store"],
        memory,
        forgot,
        alreadyGone,
        forgetFailures,
        forgetShortfalls: forgetShortfalls.map(redactText),
        bucketsSwept,
        bucketsToSweep: userIds.length,
        seeded,
        expectedSeeds,
        bucketsSeeded,
        skippedProjectScoped,
        // `detail` embeds an arbitrary `Error.message`, which can quote the backend
        // address verbatim (undici: "Failed to parse URL from …") or name the bare
        // hostname (`getaddrinfo ENOTFOUND …`). The presenter still gets the phase,
        // every counter and the cause.
        memoryError: redactText(detail),
      },
      { status: 502 },
    );
  }
};
