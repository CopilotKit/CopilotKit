import { describe, expect, it } from "vitest";
import { bankingSuggestions, Q2_REPORT_MESSAGE } from "./suggestions";

/**
 * Guards the Q2 multimodal invoice beat.
 *
 * The beat fires only when the selected suggestion's `message` equals
 * `Q2_REPORT_MESSAGE` — `skin.tsx`'s `onSuggestionSelect` matches by string
 * equality to stage the bundled invoice attachment and drive the real composer.
 *
 * The string used to be duplicated (once here as the pill's `message`, once as a
 * const in `skin.tsx`), and drifting them apart made the pill fall through to a
 * plain text send with every other test still green. It is now declared ONCE in
 * `suggestions.ts` and imported by `skin.tsx`, so equality is structural rather
 * than something a test has to police.
 *
 * What remains worth asserting is that the pill the matcher depends on is
 * actually IN the catalog. Nothing else notices if it is dropped or retitled:
 * `onSuggestionSelect` would simply never match, and the beat would go missing
 * silently.
 */
describe("banking Q2 report suggestion", () => {
  it("keeps a pill in the catalog carrying Q2_REPORT_MESSAGE", () => {
    const matching = bankingSuggestions.filter(
      (s) => s.message === Q2_REPORT_MESSAGE,
    );
    expect(
      matching,
      "onSuggestionSelect matches Q2_REPORT_MESSAGE by string equality, so exactly one pill must carry it",
    ).toHaveLength(1);
  });

  it("keeps that pill titled so the demo script still reads correctly", () => {
    const q2 = bankingSuggestions.find((s) => s.message === Q2_REPORT_MESSAGE);
    expect(q2?.title).toBe("Prep the Q2 spend report");
  });
});
