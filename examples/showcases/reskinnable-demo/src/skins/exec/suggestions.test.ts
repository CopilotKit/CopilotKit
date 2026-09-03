import { describe, expect, it } from "vitest";
import { execSuggestions, MEMO_NARRATIVE_MESSAGE } from "./suggestions";

/**
 * Guards the beat 3d multimodal-memo beat.
 *
 * The beat fires only when the selected suggestion's `message` equals
 * `MEMO_NARRATIVE_MESSAGE` — `skin.tsx`'s `onSuggestionSelect` matches by
 * string equality to stage the generated memo PDF and drive the real composer
 * (mirrors banking's `Q2_REPORT_MESSAGE` mechanism, see
 * `src/skins/banking/suggestions.test.ts`).
 *
 * The string is declared ONCE in `suggestions.ts` and imported by both
 * `skin.tsx` and `attach-memo.ts`, so equality is structural rather than
 * something a test has to police. What remains worth asserting is that the
 * pill the matcher depends on is actually IN the catalog: nothing else
 * notices if it is dropped or retitled — `onSuggestionSelect` would simply
 * never match, and the beat would go missing silently.
 */
describe("exec memo-narrative suggestion", () => {
  it("keeps exactly one pill carrying MEMO_NARRATIVE_MESSAGE", () => {
    const matching = execSuggestions.filter(
      (s) => s.message === MEMO_NARRATIVE_MESSAGE,
    );
    expect(
      matching,
      "onSuggestionSelect matches MEMO_NARRATIVE_MESSAGE by string equality, so exactly one pill must carry it",
    ).toHaveLength(1);
  });

  it("keeps that pill titled so the demo script still reads correctly", () => {
    const memo = execSuggestions.find(
      (s) => s.message === MEMO_NARRATIVE_MESSAGE,
    );
    expect(memo?.title).toBe("File the attached memo as a narrative");
  });
});
