import * as store from "@/skins/exec/data/store";
import { presenterResetEnabled } from "@/lib/presenter";
import { forgetAllMemories } from "@/skins/exec/intelligence/forget-memories";
import { seedMemories } from "@/skins/exec/intelligence/seed-memories";
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
  if (!apiUrl || !apiKey) {
    // OSS path: there is no durable memory to clear, and beats 2/4/5/6 degrade
    // by design. Report exactly what was reset rather than implying more.
    return Response.json({ ok: true, reset: ["store"] });
  }

  // Declared outside the try/catch below so a mid-loop failure can still
  // report PARTIAL progress: the store is already reset and some identities
  // may already be forgotten, and an error body that reads "memory untouched"
  // would send a presenter looking in the wrong place.
  let forgot = 0;
  let seeded = 0;
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
      skippedProjectScoped = Math.max(
        skippedProjectScoped,
        result.skippedProjectScoped,
      );
    } catch (err) {
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

  if (failures.length > 0) {
    return Response.json(
      {
        ok: false,
        reset: forgot > 0 ? ["store", "memory"] : ["store"],
        apiUrl,
        forgot,
        seeded,
        skippedProjectScoped,
        memoryError: failures.join("; "),
      },
      { status: 502 },
    );
  }

  return Response.json({
    ok: true,
    reset: ["store", "memory"],
    apiUrl,
    forgot,
    seeded,
    skippedProjectScoped,
  });
};
