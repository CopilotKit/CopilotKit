import { describe, it, expect } from "vitest";
import {
  buildBudgetMemoPdf,
  DriverSplitError,
  NotAnOverrunError,
} from "./budget-memo-pdf";
import type { BudgetMemoInput } from "./budget-memo-pdf";

const INPUT: BudgetMemoInput = {
  periodLabel: "August 2026",
  // Preformatted by the route, in the memo's one locale (en-US).
  memoDate: "September 5, 2026",
  planUsd: 216_000,
  actualUsd: 235_440,
  variancePct: 0.09,
  timingUsd: 12_053,
  oneOffUsd: 7_387,
};

const build = (input: BudgetMemoInput = INPUT) =>
  Buffer.from(buildBudgetMemoPdf(input)).toString("latin1");

/**
 * The memo's PROSE, recovered from the content stream: the drawn strings only,
 * with the writer's `\(`/`\)` escapes undone and its word-boundary line wraps
 * re-joined, so an assertion can quote a sentence as a reader sees it rather
 * than guessing where the wrap fell.
 */
const prose = (input: BudgetMemoInput = INPUT) =>
  [...build(input).matchAll(/\((.*)\) Tj/g)]
    .map((m) => m[1].replace(/\\([()\\])/g, "$1"))
    .join(" ");

describe("the budget memo document", () => {
  it("is a PDF", () => {
    expect(build().startsWith("%PDF-")).toBe(true);
  });

  it("prints the period, the plan/actual figures and the overrun", () => {
    const text = build();
    expect(text).toContain("August 2026");
    expect(text).toContain("$235,440");
    expect(text).toContain("$216,000");
    expect(text).toContain("$19,440");
  });

  /**
   * The percentage was the one input the memo printed and nothing asserted:
   * `variancePct` could have been dropped from the summary sentence, or
   * printed as the raw fraction (`0.09`), or signed on a miss, with every
   * other test still green.
   */
  it("prints the variance as a percentage of plan, inside the summary sentence", () => {
    // Anchored to the words around it: a bare "9%" substring would still
    // match "-9%", so a sign regression could not fail this test.
    expect(prose()).toContain("(9% over plan)");
    // The printed figure TRACKS the input rather than being a fixed string.
    expect(prose({ ...INPUT, variancePct: 0.125 })).toContain(
      "(12.5% over plan)",
    );
    // Never the raw fraction — the memo is a document, not a payload.
    expect(build()).not.toContain("0.09");
  });

  /**
   * The summary sentence is written for an OVERRUN and has no wording for the
   * opposite case, so a non-positive variance is not something this builder
   * can render honestly — `Math.abs` would have printed "an overrun of
   * -$19,440 (9% over plan)", stripping the sign out of a finance document.
   *
   * The route (`app/api/exec/v1/budget-memo/route.ts`) is the PRIMARY gate:
   * it 404s on an under-plan breach before ever reaching the builder. This is
   * the second line — `buildBudgetMemoPdf` is exported, so it must refuse on
   * its own rather than trusting every future caller to check first.
   */
  it("refuses to render a variance its prose cannot describe", () => {
    expect(() => build({ ...INPUT, variancePct: -0.09 })).toThrow(
      NotAnOverrunError,
    );
    expect(() => build({ ...INPUT, variancePct: 0 })).toThrow(
      NotAnOverrunError,
    );
    // The dollar overrun is a second, independent input: a positive
    // `variancePct` paired with an actual at or below plan is just as
    // unprintable.
    expect(() => build({ ...INPUT, actualUsd: INPUT.planUsd - 1 })).toThrow(
      NotAnOverrunError,
    );
  });

  it("prints both driver amounts", () => {
    const text = build();
    expect(text).toContain("$12,053");
    expect(text).toContain("$7,387");
    // The fixture's own split satisfies the builder's driver invariants
    // (12,053 + 7,387 === the 19,440 overrun, timing the larger) — those
    // invariants are exercised as REFUSALS in the two tests below, since a
    // fixed pair of numbers here would pass whether or not they were checked.
  });

  /**
   * "DRIVERS" IS AN ACCOUNT OF THE OVERRUN, and the memo prints it directly
   * under the overrun figure — a reader who adds the two amounts up and lands
   * somewhere else is reading a document that contradicts itself in the only
   * arithmetic it asks them to do. The header claimed this and nothing
   * enforced it: every driver amount was printed exactly as handed in, so a
   * caller computing the split against the wrong period's point (or against
   * the forecast rather than the plan) produced a memo that looked right on
   * stage and did not add up.
   */
  it("refuses a driver split that does not account for the overrun", () => {
    expect(() => build({ ...INPUT, oneOffUsd: 7_000 })).toThrow(
      DriverSplitError,
    );
    // Over as well as under — neither direction is an account of the overrun.
    expect(() => build({ ...INPUT, oneOffUsd: 8_000 })).toThrow(
      DriverSplitError,
    );
    // And it is the OVERRUN it must sum to, not the actual or the plan.
    expect(() =>
      build({ ...INPUT, timingUsd: 150_000, oneOffUsd: 85_440 }),
    ).toThrow(DriverSplitError);
  });

  /**
   * The timing driver being the strictly LARGER of the two is the entire cue
   * the reader (and the model reading the attachment) infers VAR-TIMING from
   * — the memo never prints a narrative code itself, deliberately. An
   * inverted split silently plants VAR-ONEOFF instead, and a tie plants
   * nothing, on a document whose whole job in beat 3d is to carry that cue.
   */
  it("refuses an inverted or tied driver split", () => {
    // Inverted: still sums to the overrun, so only the ordering check fails.
    expect(() =>
      build({ ...INPUT, timingUsd: 7_387, oneOffUsd: 12_053 }),
    ).toThrow(DriverSplitError);
    // A tie plants no cue at all.
    expect(() =>
      build({ ...INPUT, timingUsd: 9_720, oneOffUsd: 9_720 }),
    ).toThrow(DriverSplitError);
  });

  it("prints no narrative code, filedAt, or exception status", () => {
    // Those are the register's to settle server-side (see the header
    // comment) — printing one here would hand the model the very field
    // `POST /narratives` exists to own.
    const text = build();
    expect(text).not.toMatch(/VAR-(TIMING|ONEOFF|FX|PLAN)/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(text).not.toContain("explained");
  });

  it("emits only single-byte characters, even from typographic input", () => {
    // Assert the BYTES, not a decoded string: once the document is ASCII the
    // two are the same thing, so a character-level check would pass for the
    // same reason the builder is correct and could never fail for the case it
    // exists to catch. The title itself carries an em dash ("—"), and a
    // period like "period — 2026" folds a typographic dash the same way.
    const bytes = buildBudgetMemoPdf({
      ...INPUT,
      periodLabel: "Q3 — 2026",
    });
    for (const byte of bytes) expect(byte).toBeLessThan(0x80);
  });
});
