import * as store from "@/skins/exec/data/store";
import { presenterResetEnabled } from "@/lib/presenter";
import { redactSecrets } from "@/lib/redact-secrets";
import {
  ForgetMemoriesError,
  forgetAllMemories,
} from "@/skins/exec/intelligence/forget-memories";
import {
  SEED_MEMORIES,
  seedMemories,
} from "@/skins/exec/intelligence/seed-memories";
import {
  DEMO_DEFAULT_USER_ID,
  SEED_TARGET_USER_IDS,
  SEEDED_USER_IDS,
} from "@/skins/exec/intelligence/user-id";

/**
 * Presenter/booth reset — put Vantage back to the state the demo starts from.
 *
 * Four things have to be true afterwards, and all four are easy to get wrong:
 *   1. The ledger is re-seeded — narratives cleared, exceptions unexplained
 *      again, dashboards/drafts back to the seed layout.
 *   2. LEARNED memory is wiped, including the default bucket where memory
 *      taught mid-demo actually lands. Skip that bucket and beat 6 starts out
 *      already knowing the answer, which is the single most demo-destroying
 *      form this bug takes: everything still works, it just proves nothing.
 *   3. The beats 4/5 memories are put BACK, so "it already knows me" works on a
 *      cold reset with no warm-up run.
 *   4. Beat 6's publish-unlock procedure is still NOT known. That falls out of
 *      (2) + (3) because `SEED_MEMORIES` deliberately omits it — see
 *      seed-memories.ts.
 *
 * Allowed when a booth deployment set PRESENTER_RESET_ENABLED, OR in any
 * non-production environment. Keeping this in agreement with the sidebar
 * button matters: gate it more tightly than the button and a production
 * booth shows a Reset control that 403s.
 */
export const POST = async () => {
  if (!presenterResetEnabled() && process.env.NODE_ENV === "production") {
    return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  store.reset();

  const apiUrl = process.env.INTELLIGENCE_API_URL;
  const apiKey = process.env.CPK_INTELLIGENCE_API_KEY;
  if (!apiUrl && !apiKey) {
    // OSS path: there is no durable memory to clear, and beats 2/4/5/6 degrade
    // by design. Report exactly what was reset rather than implying more.
    return Response.json({ ok: true, reset: ["store"] });
  }
  if (!apiUrl || !apiKey) {
    /**
     * HALF-CONFIGURED — a MISCONFIGURATION, not the OSS path, and the
     * distinction is the whole point of splitting this branch in two.
     *
     * `!apiUrl || !apiKey` used to cover both, so a booth that set the backend
     * address and forgot the secret (or had the secret expire out of the
     * deploy) got `ok: true, reset: ["store"]` — a green Reset button, memory
     * NEVER swept, and nothing on screen saying so. Beat 6 then opens already
     * taught by the previous run, which is the single most demo-destroying
     * shape this bug takes: everything still works, it just proves nothing.
     * Someone who deliberately runs without Intelligence sets NEITHER var; one
     * var alone is always an accident.
     *
     * 500, not 502: nothing upstream was contacted or refused anything — the
     * fault is entirely this deployment's env. The names of the vars are safe
     * to echo; their VALUES are not, so the message names only which one is
     * missing and still goes through `redactSecrets` on the way out.
     */
    const missing = apiUrl
      ? "CPK_INTELLIGENCE_API_KEY"
      : "INTELLIGENCE_API_URL";
    const present = apiUrl
      ? "INTELLIGENCE_API_URL"
      : "CPK_INTELLIGENCE_API_KEY";
    const memoryError = redactSecrets(
      `Intelligence is HALF-configured: ${present} is set but ${missing} is ` +
        `not, so durable memory was NOT swept or re-seeded. Set both (or ` +
        `neither, for the OSS path) and reset again — beats 4/5 are not armed ` +
        `and beat 6 may still be taught from a previous run.`,
    );
    console.error(`[exec] presenter reset: ${memoryError}`);
    return Response.json(
      { ok: false, reset: ["store"], memoryError },
      { status: 500 },
    );
  }

  // Declared outside the try/catch below so a mid-loop failure can still
  // report PARTIAL progress: the store is already reset and some identities
  // may already be forgotten, and an error body that reads "memory untouched"
  // would send a presenter looking in the wrong place.
  let forgot = 0;
  let seeded = 0;
  // Rows that were ALREADY absent when the DELETE landed (404/410) — a
  // concurrent reset or a backend TTL got there first. Success for the purpose
  // of this reset (the row is gone either way), but reported separately so
  // `forgot` stays literally true. See intelligence/forget-memories.ts.
  let alreadyGone = 0;
  // Project-scoped rows the forget helper deliberately left alone — they belong
  // to sibling demos sharing this backend, not to Vantage. Reported rather than
  // hidden: a non-zero count after a Vantage-only session means something saved
  // project-scoped despite the prompt, which is the one way beat 6 could start
  // out already taught. See intelligence/forget-memories.ts.
  let skippedProjectScoped = 0;
  // Per-bucket forget/seed failures, so a 502 body can say exactly which
  // identity failed rather than a single opaque error.
  const failures: string[] = [];

  // A pinned `INTELLIGENCE_USER_ID` (Playwright pins one) short-circuits
  // `resolveUserId` (`intelligence/user-id.ts`), so at runtime EVERY memory
  // lands in that one bucket — which neither of the static lists below names.
  // Without it a pinned run resets two buckets nothing was ever written to
  // and leaves the live one intact: beat 6 starts out already taught and the
  // reset still reports success. Bookstore's reset route makes the same move
  // (a Set, since a pinned id may already be in the list, and clearing one
  // bucket twice is a wasted round trip and a double-counted `forgot`).
  const pinnedUserId = process.env.INTELLIGENCE_USER_ID;
  const userIds = [
    ...new Set([
      ...SEEDED_USER_IDS,
      DEMO_DEFAULT_USER_ID,
      ...(pinnedUserId ? [pinnedUserId] : []),
    ]),
  ];
  const seedTargets = [
    ...new Set([
      ...SEED_TARGET_USER_IDS,
      ...(pinnedUserId ? [pinnedUserId] : []),
    ]),
  ];
  // Name the backend and the exact ids BEFORE mutating. Several demos in this
  // repo vendor the same Intelligence stack, so if this process ever resolved a
  // neighbour's apiUrl, this line is where a human sees the reset was about to
  // reach across into someone else's memory.
  console.warn(
    `[exec] presenter reset: forgetting memories at ${apiUrl} for ${userIds.join(", ")}` +
      `; re-seeding ${seedTargets.join(", ")}`,
  );

  // `forgetAllMemories` THROWS on the first failed DELETE within a bucket.
  // Each userId is its own try/catch so one bucket's throw does not skip the
  // rest — otherwise a single bad delete for the mapped operator would leave
  // the demo-default bucket (where mid-demo teaching actually lands) never
  // even attempted.
  for (const userId of userIds) {
    try {
      const result = await forgetAllMemories({ apiUrl, apiKey, userId });
      forgot += result.forgot;
      alreadyGone += result.alreadyGone;
      if (!result.complete) {
        // The sweep ran without throwing but could NOT prove the bucket was
        // emptied — the list endpoint's pagination contract is unknown, so
        // `forgetAllMemories` verifies rather than assumes (see its header).
        // An unproven clear must never be reported as a clean reset: rows left
        // behind are exactly how beat 6 opens already taught while the button
        // reads "done".
        failures.push(
          `forget ${userId}: incomplete sweep after ${result.passes} pass(es): ` +
            `${result.incompleteReason ?? "unknown reason"}`,
        );
      }
      // MAX, not a sum: verified against the running Intelligence stack (see
      // the doc comment on `skippedProjectScoped` in forget-memories.ts and
      // `intelligence/user-id.ts`'s header), the bare list returns every
      // `scope: "project"` row for ANY user id — project scope is global to
      // the backend instance, not partitioned per bucket. Every userId's list
      // call re-sees the SAME project-scoped rows, so summing across buckets
      // would report N× the truth; the largest single-bucket count is exact.
      skippedProjectScoped = Math.max(
        skippedProjectScoped,
        result.skippedProjectScoped,
      );
    } catch (err) {
      // `ForgetMemoriesError` carries however many rows THIS bucket deleted
      // before the failure that ended its sweep — without reading it, a
      // 9-of-10 bucket reported `forgot: 0` on throw, discarding progress the
      // loop already made. See forget-memories.ts.
      if (err instanceof ForgetMemoriesError) forgot += err.forgot;
      failures.push(
        `forget ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Seed EVERY target bucket — see SEED_TARGET_USER_IDS. Runs currently
  // resolve to the default identity, so seeding only the mapped operator
  // leaves recall looking at an empty bucket and beats 4/5 fail silently.
  // `seedMemories` never throws (failures are counted/logged internally), so
  // no per-bucket try/catch is needed here.
  for (const userId of seedTargets) {
    seeded += await seedMemories({ apiUrl, apiKey, userId });
  }

  // `seedMemories` NEVER throws — it counts stored rows and logs the rest —
  // so reaching this line proves nothing about whether memory was written.
  // Without this comparison, a backend that rejected every single seed POST
  // still earned `ok: true, reset: ["store", "memory"]`: beats 4/5 dead on
  // arrival, reported as a clean reset. The expected count is knowable
  // (`SEED_MEMORIES` is a fixed literal, `seedTargets` a derived list), so it
  // is compared rather than assumed.
  const expectedSeeds = seedTargets.length * SEED_MEMORIES.length;
  const seedShortfall = seeded < expectedSeeds;

  if (failures.length > 0 || seedShortfall) {
    if (seedShortfall) {
      failures.push(
        `seeded ${seeded} of ${expectedSeeds} expected memories across ` +
          `${seedTargets.length} bucket(s); beats 4/5 are not armed`,
      );
    }
    const memoryError = redactSecrets(failures.join("; "));
    console.error(`[exec] presenter reset: ${failures.join("; ")}`);
    return Response.json(
      {
        ok: false,
        // NOT ["store", "memory"] even when some forgets succeeded: memory
        // only counts as reset once it is wiped AND fully re-seeded, and a
        // seed shortfall means it is not — see keel's/commerce's dev/reset
        // for the same rule.
        reset: ["store"],
        // Redacted: an upstream `Error.message` (or a rejected backend
        // response body) can quote the API key or the backend address back
        // verbatim. See src/lib/redact-secrets.ts.
        apiUrl: redactSecrets(apiUrl),
        forgot,
        alreadyGone,
        seeded,
        expectedSeeds,
        skippedProjectScoped,
        memoryError,
      },
      { status: 502 },
    );
  }

  return Response.json({
    ok: true,
    reset: ["store", "memory"],
    apiUrl: redactSecrets(apiUrl),
    forgot,
    alreadyGone,
    seeded,
    expectedSeeds,
    skippedProjectScoped,
  });
};
