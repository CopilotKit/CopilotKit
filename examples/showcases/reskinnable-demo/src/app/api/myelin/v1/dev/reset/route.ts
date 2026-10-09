import * as store from "@/skins/myelin/data/store";
import { presenterResetEnabled } from "@/lib/presenter";
import { redactSecrets } from "@/lib/redact-secrets";
import { forgetAllMemories } from "@/skins/myelin/intelligence/forget-memories";
import {
  SEED_MEMORIES,
  seedMemories,
} from "@/skins/myelin/intelligence/seed-memories";
import {
  memoryScopeUserIds,
  memorySeedTargetUserIds,
} from "@/skins/myelin/intelligence/user-id";

/**
 * Presenter reset: restore the seeded Harvest Lane scenario, wipe everything the
 * agent learned, and re-seed beats 4/5 (leaving beat 6 unlearned).
 *
 * The store is reset FIRST and never rolled back, so every response except the
 * 403 carries `reset: ["store", …]` and the client reloads. Mirrors commerce's
 * route, trimmed.
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
  if (!apiUrl || !apiKey) return Response.json({ ok: true, reset: ["store"] });

  const shortfalls: string[] = [];
  let forgot = 0;
  let seeded = 0;
  try {
    for (const userId of memoryScopeUserIds()) {
      const result = await forgetAllMemories({ apiUrl, apiKey, userId });
      forgot += result.forgot;
      if (!result.complete)
        shortfalls.push(
          `${userId}: ${result.incompleteReason ?? "not proven empty"}`,
        );
    }
    const targets = memorySeedTargetUserIds();
    for (const userId of targets)
      seeded += await seedMemories({ apiUrl, apiKey, userId });
    const expected = targets.length * SEED_MEMORIES.length;

    if (shortfalls.length || seeded < expected) {
      return Response.json(
        {
          ok: false,
          reset: ["store"],
          forgot,
          seeded,
          expected,
          memoryError: shortfalls.length
            ? redactSecrets(
                `memory wipe did not finish (${shortfalls.join(" | ")}); the teach beat may start out already taught`,
              )
            : `seeded ${seeded} of ${expected} memories; the memory beats are not armed`,
        },
        { status: 502 },
      );
    }
    return Response.json({
      ok: true,
      reset: ["store", "memory"],
      forgot,
      seeded,
      expected,
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        reset: ["store"],
        forgot,
        seeded,
        memoryError: redactSecrets(
          err instanceof Error ? err.message : String(err),
        ),
      },
      { status: 502 },
    );
  }
};
