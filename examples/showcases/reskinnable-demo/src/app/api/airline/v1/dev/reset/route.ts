import * as store from "@/skins/airline/data/store";
import { presenterResetEnabled } from "@/lib/presenter";

/**
 * Presenter/booth reset — put Aeronova's traveler profile back to the state the
 * demo starts from.
 *
 * `store.reset()` re-clones the seed, which drops every record the beats write:
 * beat 5's reissue, seat and 🚨 notice (all of which live ON the booking), beat
 * 6's filed exceptions and the `activeExceptionId` links that go with them, and
 * beat 3d's trip briefs. That last one matters as much as the rest — a reset
 * that left last run's brief on the trip would open the demo with an artifact
 * whose document was never ingested in front of THIS audience.
 *
 * ⚠️ THIS RESET DOES NOT TOUCH DURABLE MEMORY, AND THAT IS A KNOWN GAP. Beats 4,
 * 5 and 6 are seeded, not emergent: they need
 * `src/skins/airline/intelligence/seed-memories.ts` and its sibling
 * `forget-memories.ts`, which this skin does not have yet (`ls
 * src/skins/*​/intelligence/seed-memories.ts` names the skins that do). Until a
 * later slot adds them, an Intelligence-mode deploy that has already run the
 * demo once will start the SECOND run with beat 6's procedure ALREADY LEARNED —
 * the single most demo-destroying state this app has, because everything still
 * works and it just proves nothing.
 *
 * The response says so out loud in `memoryBeats` rather than letting a bare
 * `{ ok: true }` imply the demo is fully re-armed. `demo-beats.md` calls a reset
 * route without a seed file "a silent trap, because its Reset button looks
 * identical"; this field is what stops it being silent.
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

  return Response.json({
    ok: true,
    reset: ["store"],
    // NOT "seeded", and deliberately not omitted. See the header.
    memoryBeats: "unarmed",
    memoryNote:
      "Aeronova has no seed-memories module yet, so beats 4, 5 and 6 are not " +
      "re-armed by this reset. In Intelligence mode a learned procedure from a " +
      "previous run survives it.",
  });
};
