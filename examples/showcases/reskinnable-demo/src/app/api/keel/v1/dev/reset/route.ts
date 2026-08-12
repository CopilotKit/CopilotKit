import * as store from "@/skins/keel/data/store";
import { presenterResetEnabled } from "@/lib/presenter";

/**
 * Presenter/booth reset — put the Harbor Point desk back to the state the demo
 * starts from.
 *
 * What this restores, and all of it is easy to get wrong:
 *   1. The register is rebuilt from the corpus with dates re-anchored to NOW, so
 *      POL-114 Rev D and POL-208 Rev C are unreleased and unendorsed again, and
 *      beat 3c's `review_overdue` lever still discriminates rather than having
 *      drifted into flagging everything.
 *   2. Beat 5's three writes are gone — the review flag, the owner notices and
 *      the 🚨 note all live ON the document record, so rebuilding drops every
 *      one. A register that opened with last run's note already on POL-121 would
 *      make the stored procedure look like it ran before anyone asked.
 *   3. Variances and impact briefs are emptied. A surviving ratified variance
 *      would leave beat 6 already unlocked — the most demo-destroying form this
 *      bug takes, because everything still works and it just proves nothing.
 *   4. Runs are re-seeded to their four starting states.
 *
 * ⚠️ WHAT THIS DOES **NOT** DO, STATED LOUDLY BECAUSE THE BUTTON LOOKS
 * IDENTICAL EITHER WAY: it does not touch durable MEMORY. Keel has no
 * `intelligence/seed-memories.ts` or `intelligence/forget-memories.ts` yet, so
 * this reset CANNOT wipe a learned procedure or re-arm the "it already knows me"
 * memories that beats 4, 5 and 6 depend on. Run beat 6 twice against an
 * Intelligence backend and the second room watches an agent that already knows
 * the answer.
 *
 * That is a KNOWN GAP owned by the memory slot, not an accident of this one:
 * listing every skin's `intelligence/seed-memories.ts` is the command that says
 * which skins can re-arm those beats, and keel is deliberately absent from it.
 * When the pair lands, this route grows the wipe/re-seed phases and its `reset`
 * array gains `"memory"` — the shape to copy is
 * `src/app/api/logistics/v1/dev/reset/route.ts`, including its measured
 * `seeded/expected` verdict (never a bare "ok") and its `redactSecrets` pass
 * over every free-text field that quotes a backend error.
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

  // `reset: ["store"]` and nothing more. Listing "memory" here would be the
  // single most misleading string this route could return — a presenter reading
  // it would stop looking for the reason beat 6 opened already taught.
  return Response.json({ ok: true, reset: ["store"] });
};
