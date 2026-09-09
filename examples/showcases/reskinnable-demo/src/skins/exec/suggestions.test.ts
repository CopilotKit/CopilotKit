import { beforeEach, describe, expect, it } from "vitest";
import { execSuggestions, MEMO_NARRATIVE_MESSAGE } from "./suggestions";
import { execAgent } from "./agent";
import * as store from "./data/store";
import type { NarrativeCode } from "./data/types";

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

/**
 * A PILL IS AGENT-FACING TEXT. Its `message` is sent verbatim as the operator's
 * turn, so a `VAR-*` code spelled in one would hand beat 6 the answer it is
 * supposed to have to be TAUGHT — the same leak `agent-tools.test.ts` polices
 * on the prompt and the tool descriptions, on the one surface that suite
 * cannot see. Titles are swept too: they are one careless copy-paste away from
 * becoming a message.
 */
describe("exec suggestion pills", () => {
  /**
   * DERIVED FROM THE UNION, NOT COPIED FROM IT — same device, same reason, as
   * `agent-tools.test.ts`'s list. `NarrativeCode` is a TYPE and cannot be
   * enumerated at runtime (the only module-scope catalogue lives in the human
   * filing form, `pages/board-packs.tsx`, and is deliberately unexported), so
   * `as const satisfies Record<NarrativeCode, true>` is what binds this list to
   * it: a FIFTH code added to the union fails the typecheck here rather than
   * quietly slipping through a sweep that never knew to look for it.
   */
  const WITHHELD_CODES = Object.keys({
    "VAR-TIMING": true,
    "VAR-ONEOFF": true,
    "VAR-FX": true,
    "VAR-PLAN": true,
  } as const satisfies Record<NarrativeCode, true>);

  it("names no narrative code in any pill", () => {
    for (const pill of execSuggestions) {
      for (const text of [pill.title, pill.message]) {
        for (const code of WITHHELD_CODES) {
          expect(text, `leaked a narrative code: ${pill.title}`).not.toContain(
            code,
          );
        }
      }
    }
  });
});

/**
 * THE PILLS THAT ASSERT SOMETHING. Two of them state a fact rather than an
 * ask, and each is a promise the app has to keep on stage:
 *
 *  - beat 3a opens by telling the agent Distribution opex ran OVER plan in the
 *    latest closed month. If the seed stopped breaching there — or breached
 *    UNDER plan — the pill would be feeding the room a figure the ledger
 *    contradicts the moment the agent reads it with `get_metrics`.
 *  - beat 3c promises "the biggest one at the top of the list". The explorer
 *    only sorts by |variance| when the `top` lever is a positive integer
 *    (`pages/metric-rows.ts`), so that promise is kept ONLY if EXEC_PROMPT's
 *    lever rule tells the model to pass a real limit for a "worst/biggest"
 *    ask, rather than the `0` sentinel that means "do not touch this control".
 */
describe("exec pill promises match the app", () => {
  beforeEach(() => store.reset());

  const prompt = () =>
    (execAgent() as unknown as { config: { prompt: string } }).config.prompt;

  /**
   * Rule `n`'s BODY — the heading number is sliced off deliberately, so a
   * `\b10\b` assertion below reads the rule's own text and cannot be satisfied
   * by the "10." it is numbered with.
   */
  const rule = (n: number) => {
    const text = prompt();
    const heading = `\n${n}. `;
    const start = text.indexOf(heading);
    expect(start, `EXEC_PROMPT has no rule ${n}`).toBeGreaterThan(-1);
    const end = text.indexOf(`\n${n + 1}. `, start);
    return text.slice(start + heading.length, end === -1 ? undefined : end);
  };

  it("beat 3a's pill states an overrun the seed actually shows", () => {
    const pill = execSuggestions.find((s) =>
      s.message.includes("Distribution opex ran over plan"),
    );
    expect(pill, "beat 3a's pill is gone or reworded").toBeDefined();

    const exception = store
      .exceptions()
      .find((e) => e.metricId === "opex" && e.department === "distribution");
    expect(
      exception,
      "the seed no longer breaches Distribution opex — the pill states a fact the ledger denies",
    ).toBeDefined();
    // "ran OVER plan": a positive variance, and still waiting on a narrative,
    // or the two-turn filing beat has nothing to file against.
    expect(exception!.variancePct).toBeGreaterThan(0);
    expect(exception!.explained).toBe(false);
  });

  it("beat 3c's 'biggest at the top' is backed by the lever rule", () => {
    const pill = execSuggestions.find((s) =>
      s.message.includes("the biggest one"),
    );
    expect(pill, "beat 3c's pill is gone or reworded").toBeDefined();

    // The rule must connect a worst/biggest ask to a REAL top-N, since the 0
    // sentinel leaves the board in ledger order.
    const leverRule = rule(10);
    expect(leverRule).toMatch(/biggest|worst/i);
    expect(
      leverRule,
      "rule 10 must name a real top-N limit for a 'biggest first' ask, not just the 0 sentinel",
    ).toMatch(/\b10\b/);
    expect(leverRule).toMatch(/sort|order/i);
  });
});
