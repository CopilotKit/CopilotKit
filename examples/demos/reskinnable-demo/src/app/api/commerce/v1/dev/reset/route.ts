import * as store from "@/skins/commerce/data/store";
import { presenterResetEnabled } from "@/lib/presenter";
import { redactSecrets } from "@/lib/redact-secrets";
import { forgetAllMemories } from "@/skins/commerce/intelligence/forget-memories";
import {
  SEED_MEMORIES,
  seedMemories,
} from "@/skins/commerce/intelligence/seed-memories";
import {
  memoryScopeUserIds,
  memorySeedTargetUserIds,
} from "@/skins/commerce/intelligence/user-id";

/**
 * How much of the beats 4/5 memory actually landed. Reported as a word, not
 * inferred by the caller from two numbers.
 *
 *  - `seeded`  — every expected memory is in every target bucket. The ONLY state
 *                in which this route may claim `reset: ["store", "memory"]`.
 *  - `partial` — some landed. Beats 4/5 may work, may not: `seedMemories`
 *                iterates `SEED_MEMORIES` in order and swallows per-row failures,
 *                so a shortfall says nothing about WHICH memory is missing. The
 *                beat-4 preference and the beat-5 procedure are independent, so a
 *                presenter cannot reason "3 of 4 means only the last one is gone".
 *  - `failed`  — nothing landed. Beats 4 and 5 WILL fail on stage.
 */
type MemoryStatus = "seeded" | "partial" | "failed";

/**
 * Compare against the KNOWABLE expectation instead of reporting whatever
 * happened. The count is knowable because both factors are: `SEED_MEMORIES` is a
 * fixed literal and `memorySeedTargetUserIds()` is derived from `resolveUserId`.
 *
 * `expected === 0` is deliberately `failed`, never a vacuous "seeded": zero
 * expected memories means either `SEED_MEMORIES` was emptied or the target-bucket
 * derivation returned nothing, and in both cases the memory beats are unarmed.
 * Treating "expected nothing, got nothing" as success is the same lie this whole
 * classification exists to remove, one level up.
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
 * target, and an exception proves at least one of those did not finish. So the
 * only question left is whether anything landed at all — and that is answered by
 * counters, not by a proxy:
 *
 *  - `bucketsSwept` (not `forgot`) is what says the wipe did something. A bucket
 *    that was legitimately EMPTY forgets zero rows, which is the normal state of
 *    a second reset in a row, so `forgot === 0` says nothing about whether the
 *    sweep ran.
 *  - `seeded` says the same for the seed half.
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
 * Keep the Intelligence SECRETS out of RESPONSE bodies while leaving them in the
 * SERVER LOGS, which is the only place they belong.
 *
 * The route's gate (`PRESENTER_RESET_ENABLED`, or any non-production env) is a
 * demo convenience, NOT an authorization boundary — a booth deployment that sets
 * it answers this POST for anyone who can reach the box. So the body must not
 * name the internal backend or the credential that opens it, while
 * `console.warn`/`console.error` still do: a human debugging a reset needs to see
 * WHICH stack was about to be touched (this repo vendors several), and the
 * sidebar button already tells them to read the logs.
 *
 * This exists on top of simply not putting `apiUrl` in the body, because two
 * body fields carry free text this route did not compose: `memoryError`'s `cause`
 * (an arbitrary `Error.message` — undici's own "Failed to parse URL from …"
 * names the address verbatim) and `forgetShortfalls`, whose reasons quote the
 * backend's own response body (`HTTP ${status} ${await safeText(res)}` — and a
 * 401 payload is exactly the response that echoes the key it rejected). Both are
 * redacted on the way OUT rather than at their source, so the log keeps the
 * unredacted text.
 *
 * The redactor takes the TEXT ALONE and derives its needles from the
 * environment, which is deliberate: its predecessor here took the value to
 * scrub as an argument, was handed `apiUrl`, and therefore could not remove the
 * API KEY from a body it was busy sanitizing. See src/lib/redact-secrets.ts.
 *
 * Wrapped rather than passed to `.map` directly: `map` supplies (value, index,
 * array), so `map(redactSecrets)` would hand the INDEX to the optional needle
 * parameter. `tsc` rejects that particular arity clash (`number` is not
 * `SecretNeedle[]`), so this wrapper is about intent rather than safety — it
 * states that production callers pass the text and nothing else.
 */
const redactText = (text: string) => redactSecrets(text);

/**
 * Presenter/booth reset — put Bellwether back to the state the demo starts from.
 *
 * Four things have to be true afterwards, and all four are easy to get wrong:
 *   1. The ledger is re-seeded — both below-floor markdowns pending again,
 *      order 4471 back on fraud-review with no hold and no notes, Marguerite's
 *      return un-refunded, order aging re-freshened.
 *   2. LEARNED memory is wiped in EVERY bucket this process's runtime can reach —
 *      which is why the id set is asked for (`memoryScopeUserIds()`) rather than
 *      written down here. Miss a bucket and beat 6 starts out already knowing the
 *      answer, the single most demo-destroying form this bug takes: everything
 *      still works, it just proves nothing.
 *   3. The beats 4/5 memories are put BACK — ALL of them, in EVERY target bucket
 *      — so "it already knows me" works on a cold reset with no warm-up run.
 *      This one is CHECKED rather than assumed: see `classifySeeding` below.
 *   4. Beat 6's procedure is still NOT known. That falls out of (2) + (3)
 *      because `SEED_MEMORIES` deliberately omits it — see seed-memories.ts.
 *
 * Allowed when a booth deployment set PRESENTER_RESET_ENABLED, OR in any
 * non-production environment. Keeping this in agreement with the sidebar button
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
  const apiKey = process.env.CPK_INTELLIGENCE_API_KEY;
  if (!apiUrl || !apiKey) {
    // OSS path: there is no durable memory to clear, and beats 2/4/5/6 degrade
    // by design. Report exactly what was reset rather than implying more.
    return Response.json({ ok: true, reset: ["store"] });
  }

  // Declared outside the try so the catch can report PARTIAL progress: a
  // mid-loop failure can leave the store reset and some identities already
  // forgotten, and an error body that reads "memory untouched" would send a
  // presenter looking in the wrong place.
  let forgot = 0;
  let seeded = 0;
  /**
   * How many buckets/targets each loop got THROUGH — the only figures that
   * distinguish "the sweep never ran" from "the sweep ran and the buckets were
   * legitimately empty", which `forgot`/`seeded` alone cannot: both are 0 in both
   * cases. Only the catch path reports them; on every returning path both loops
   * ran to completion, so there they would be constants.
   */
  let bucketsSwept = 0;
  let bucketsSeeded = 0;
  /**
   * Rows that were already absent when the DELETE landed. Success for the
   * reset's purposes — the row is gone either way — but kept out of `forgot` so
   * that figure stays literally true.
   */
  let alreadyGone = 0;
  /**
   * Buckets whose sweep could NOT prove it left nothing deletable behind, with
   * the reason. `forgetAllMemories` reports this as `complete: false`; it no
   * longer aborts on one bad row, so a sweep can now finish having stepped over
   * failures — which is exactly the state that must not be called a reset.
   *
   * An unfinished wipe matters as much as a short seed, and for the same reason:
   * a memory the wipe missed is a memory the demo starts out already knowing, so
   * beat 6 can appear to have been taught before anyone taught it.
   */
  const forgetShortfalls: string[] = [];
  /** Individual rows that failed to delete, across all buckets. */
  let forgetFailures = 0;
  // Project-scoped rows the forget helper deliberately left alone — they belong
  // to sibling demos sharing this backend, not to Bellwether. Reported rather
  // than hidden: a non-zero count after a Bellwether-only session means
  // something saved project-scoped despite the prompt, which is the one way beat
  // 6 could start out already taught. See intelligence/forget-memories.ts.
  let skippedProjectScoped = 0;

  // ASKED, never restated. `memoryScopeUserIds()` derives the bucket set from
  // the same `resolveUserId` the runtime identifies runs with, so the two cannot
  // drift: a pinned `INTELLIGENCE_USER_ID` (Playwright pins one) collapses the
  // set onto that single bucket, which is exactly the one the agent will use. A
  // hardcoded list here missed it entirely — the reset scrubbed `bellwether-*`
  // buckets nothing was reading while the run wrote a pinned one, so beats 4/5
  // recalled nothing and beat 6's taught procedure survived the reset.
  const userIds = memoryScopeUserIds();
  const seedTargets = memorySeedTargetUserIds();
  // Name the backend and the exact ids BEFORE mutating. Several demos in this
  // repo vendor the same Intelligence stack, so if this process ever resolved a
  // neighbour's apiUrl, this line is where a human sees the reset was about to
  // reach across into someone else's memory. It also makes the pinned-env
  // collapse VISIBLE: one id in this line means the deploy is pinned.
  //
  // THE LOG IS THE ONLY PLACE THE ADDRESS APPEARS. It used to be echoed as
  // `apiUrl` in every response body too — success and failure alike — which
  // handed the internal backend's address to anyone who could reach a booth
  // deployment that had set PRESENTER_RESET_ENABLED. Do not put it back: the
  // presenter needs to know memory failed and roughly why (`memory`,
  // `memoryError`, the counters), never where the backend lives.
  console.warn(
    `[commerce] presenter reset: forgetting memories at ${apiUrl} for ${userIds.join(", ")}`,
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
      // MAX, not a sum: verified against the running stack, the bare list returns
      // every `scope: "project"` row for ANY user id (see forget-memories.ts), so
      // each bucket re-sees the same global rows and summing would report N× the
      // truth. `forgetAllMemories` returns a count rather than ids, so the largest
      // per-bucket count is the closest this route can get to the union without
      // widening that contract; it is exact whenever the buckets saw one set.
      skippedProjectScoped = Math.max(
        skippedProjectScoped,
        result.skippedProjectScoped,
      );
      bucketsSwept += 1;
    }
    // Seed EVERY target bucket — see `memorySeedTargetUserIds`. Runs currently
    // resolve to the default identity, so seeding only the mapped operator
    // leaves recall looking at an empty bucket and beats 4/5 fail silently.
    for (const userId of seedTargets) {
      seeded += await seedMemories({ apiUrl, apiKey, userId });
      bucketsSeeded += 1;
    }

    // `seedMemories` NEVER throws — it counts stored rows and logs the rest — so
    // reaching this line proves nothing about whether memory was written. Without
    // the comparison below the route answered `ok: true, reset: ["store",
    // "memory"]` on a backend that had rejected every single POST, and the
    // presenter walked on stage believing beats 4/5 were armed. The expected
    // count is knowable, so it is compared rather than reported.
    const expectedSeeds = seedTargets.length * SEED_MEMORIES.length;
    const seedVerdict = classifySeeding(seeded, expectedSeeds);
    // The WIPE half of the same question. `forgetAllMemories` sets
    // `complete: false` when no list pass proved the bucket was empty, and it
    // deliberately steps over individual delete failures rather than abandoning
    // the remaining buckets — so "it returned" no longer implies "it finished".
    // Memory counts as reset only when it was wiped AND fully re-seeded (the
    // comment on `reset: ["store"]` below has always said so); this is the half
    // that was unverifiable until the sweep started reporting it.
    const wipeIncomplete = forgetShortfalls.length > 0;
    const memory = wipeIncomplete ? "partial" : seedVerdict;

    if (memory !== "seeded") {
      // 502 for BOTH partial and total, deliberately. Two reasons: (a) the
      // failing dependency is the upstream memory API in either case, and the
      // difference is degree, which belongs in the body — `memory`, `seeded`,
      // `expectedSeeds` — not in the status line; (b) the only caller, the
      // sidebar Reset button in src/skins/commerce/layout.tsx, branches solely on
      // `res.ok`, and a partial seed must alert exactly as loudly as a total one,
      // because a shortfall does not say WHICH memory is missing. A 200 here
      // would navigate the presenter to a clean-looking app whose memory beats
      // are quietly broken — the precise failure this route exists to prevent.
      console.error(
        `[commerce] presenter reset: seeded ${seeded}/${expectedSeeds} memories (${memory})` +
          (wipeIncomplete
            ? `; wipe incomplete — ${forgetShortfalls.join(" | ")}`
            : ""),
      );
      return Response.json(
        {
          ok: false,
          // NOT ["store", "memory"]: memory is only "reset" once it is wiped AND
          // fully re-seeded. The wipe on its own leaves the demo unarmed, so
          // listing it here would re-tell the same lie in a different field.
          reset: ["store"],
          memory,
          forgot,
          alreadyGone,
          forgetFailures,
          // Redacted, not dropped: which identity is dirty and why is the whole
          // point of this field, but a reason quoting the backend's own response
          // can carry its address OR the credential it rejected. See
          // `redactSecrets`.
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
    // Reached when a bucket cannot be ENUMERATED (`forgetAllMemories` throws
    // rather than guess at a list it never got) or anything else in the sequence
    // throws. Nobody exercises this path until it fires at a booth, so it reports
    // the same MEASURED figures as the shortfall response above instead of
    // inferring memory state from one number, which is what it used to do:
    //
    //   - `forgot > 0` claimed `reset: ["store", "memory"]` even though the seed
    //     loop may never have run — the exact "memory is armed" lie the success
    //     path was fixed to stop telling, restated in the error body;
    //   - `forgot === 0` claimed `reset: ["store"]`, indistinguishable from a
    //     sweep that ran over legitimately EMPTY buckets (the normal state of a
    //     second reset in a row) and read as "memory untouched" — sending a
    //     presenter to look in the wrong place;
    //   - and it dropped `seeded`, `alreadyGone`, `forgetShortfalls` and
    //     `skippedProjectScoped` entirely, so the progress the try HAD made was
    //     unreadable. Those accumulators live outside the try for this response.
    //
    // `reset` is always `["store"]` here: `store.reset()` ran before the try, and
    // memory only counts as reset once it was wiped AND fully re-seeded, which an
    // exception rules out.
    const expectedSeeds = seedTargets.length * SEED_MEMORIES.length;
    const memory = classifyInterrupted({ bucketsSwept, seeded });
    const cause = err instanceof Error ? err.message : String(err);
    // Name the phase from the counters rather than from a flag some future edit
    // can forget to move: the seed loop cannot start until the sweep loop is done.
    const phase = bucketsSwept < userIds.length ? "wipe" : "seed";
    const detail =
      `interrupted during the ${phase} phase — swept ${bucketsSwept}/${userIds.length} ` +
      `bucket(s), seeded ${seeded}/${expectedSeeds} memories across ` +
      `${bucketsSeeded}/${seedTargets.length} bucket(s): ${cause}` +
      (forgetShortfalls.length > 0
        ? // Surfaced even though the throw is the headline: a memory a completed
          // sweep could not prove gone is a memory the demo starts out already
          // knowing, so beat 6 can look taught before anyone taught it.
          `; ${forgetShortfalls.length} swept bucket(s) also could not prove they ` +
          `were emptied, so a surviving memory may leave beat 6 already taught`
        : "");
    // The sidebar Reset button says "See the server logs" on a non-ok response,
    // and this path used to write nothing to them. Logged UNREDACTED — this is
    // the copy a human debugging the reset reads, and `redactSecrets` exists to
    // keep the Intelligence secrets out of the RESPONSE, not out of the log. A
    // secret only reaches this line if an upstream message quoted one back, and
    // a booth's server log is not reachable by whoever can POST this route.
    console.error(`[commerce] presenter reset: ${detail}`);
    return Response.json(
      {
        ok: false,
        reset: ["store"],
        memory,
        forgot,
        alreadyGone,
        forgetFailures,
        // See the same call in the shortfall response above.
        forgetShortfalls: forgetShortfalls.map(redactText),
        bucketsSwept,
        bucketsToSweep: userIds.length,
        seeded,
        expectedSeeds,
        bucketsSeeded,
        skippedProjectScoped,
        // `detail` embeds an arbitrary `Error.message`, which can quote the
        // backend address verbatim (undici: "Failed to parse URL from …"), name
        // the bare hostname (`getaddrinfo ENOTFOUND …`), or carry any other
        // secret an upstream layer decided to mention. The presenter still gets
        // the phase, every counter and the cause.
        memoryError: redactText(detail),
      },
      { status: 502 },
    );
  }
};
