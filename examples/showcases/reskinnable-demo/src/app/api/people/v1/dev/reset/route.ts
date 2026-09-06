import * as store from "@/skins/people/data/store";
import { presenterResetEnabled } from "@/lib/presenter";
import { forgetAllMemories } from "@/skins/people/intelligence/forget-memories";
import { seedMemories } from "@/skins/people/intelligence/seed-memories";
import {
  DEMO_DEFAULT_USER_ID,
  SEED_TARGET_USER_IDS,
  SEEDED_USER_IDS,
} from "@/skins/people/intelligence/user-id";

/**
 * Presenter/booth reset — put Rowan back to the state the demo starts from.
 *
 * Four things have to be true afterwards, and all four are easy to get wrong:
 *   1. The ledger is re-seeded — both out-of-band comp requests pending again,
 *      Dana with no buddy and no checklist, request aging re-freshened.
 *   2. LEARNED memory is wiped, including the default bucket where memory
 *      taught mid-demo actually lands. Skip that bucket and beat 6 starts out
 *      already knowing the answer, which is the single most demo-destroying
 *      form this bug takes: everything still works, it just proves nothing.
 *   3. The beats 4/5 memories are put BACK, so "it already knows me" works on a
 *      cold reset with no warm-up run.
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
  // Project-scoped rows the forget helper deliberately left alone — they belong
  // to sibling demos sharing this backend, not to Rowan. Reported rather than
  // hidden: a non-zero count after a Rowan-only session means something saved
  // project-scoped despite the prompt, which is the one way beat 6 could start
  // out already taught. See intelligence/forget-memories.ts.
  let skippedProjectScoped = 0;

  const userIds = [...SEEDED_USER_IDS, DEMO_DEFAULT_USER_ID];
  // Name the backend and the exact ids BEFORE mutating. Several demos in this
  // repo vendor the same Intelligence stack, so if this process ever resolved a
  // neighbour's apiUrl, this line is where a human sees the reset was about to
  // reach across into someone else's memory.
  console.warn(
    `[people] presenter reset: forgetting memories at ${apiUrl} for ${userIds.join(", ")}`,
  );

  try {
    for (const userId of userIds) {
      const result = await forgetAllMemories({ apiUrl, apiKey, userId });
      forgot += result.forgot;
      skippedProjectScoped = Math.max(
        skippedProjectScoped,
        result.skippedProjectScoped,
      );
    }
    // Seed EVERY target bucket — see SEED_TARGET_USER_IDS. Runs currently
    // resolve to the default identity, so seeding only the mapped operator
    // leaves recall looking at an empty bucket and beats 4/5 fail silently.
    for (const userId of SEED_TARGET_USER_IDS) {
      seeded += await seedMemories({ apiUrl, apiKey, userId });
    }
    return Response.json({
      ok: true,
      reset: ["store", "memory"],
      apiUrl,
      forgot,
      seeded,
      skippedProjectScoped,
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        reset: forgot > 0 ? ["store", "memory"] : ["store"],
        apiUrl,
        forgot,
        memoryError: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
};
