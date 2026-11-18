import { describe, it, expect } from "vitest";
import {
  ANY_LEVER,
  ATTENTION_ARGUMENTS,
  SORT_ARGUMENTS,
  SPACE_ARGUMENTS,
  applyRegisterLevers,
  normalizeRegisterLevers,
  parseTopLever,
  readRegisterLevers,
  registerLeverChips,
  registerLeverQuery,
} from "./register-levers";
import { seedRegister } from "./register-seed";

const NOW = Date.parse("2026-06-01T12:00:00Z");
const records = () => seedRegister(NOW);

describe("the sentinel is a first-class member of every lever's vocabulary", () => {
  it("advertises it, so the model can SAY it is not pulling a lever", () => {
    // An `.optional()` lever gets filled anyway — a model has no way to express
    // omission. Measured in logistics: a "do not filter anything" instruction
    // still produced two filters no row satisfied and an empty board with four
    // confidently tinted controls.
    expect(SPACE_ARGUMENTS[0]).toBe(ANY_LEVER);
    expect(ATTENTION_ARGUMENTS[0]).toBe(ANY_LEVER);
    expect(SORT_ARGUMENTS[0]).toBe(ANY_LEVER);
  });

  it("drops it to null, so it draws no chip and writes no query param", () => {
    const levers = normalizeRegisterLevers({
      space: ANY_LEVER,
      attention: ANY_LEVER,
      sort: ANY_LEVER,
      top: 0,
    });
    expect(levers).toEqual({
      space: null,
      attention: null,
      sort: null,
      top: null,
    });
    expect(registerLeverChips(levers)).toEqual([]);
    expect(registerLeverQuery(levers)).toBe("");
  });
});

describe("no lever is defaulted while its argument is still streaming", () => {
  it("gives an absent lever no chip rather than asserting a choice", () => {
    // The confirm card renders from the FIRST frame of the tool call, when args
    // is `{}`. A `?? "all"` here would print a choice the agent never made, and
    // then flip when the real value landed.
    const levers = normalizeRegisterLevers({});
    expect(levers).toEqual({
      space: null,
      attention: null,
      sort: null,
      top: null,
    });
    expect(registerLeverChips(levers)).toEqual([]);
  });

  it("keeps only the levers that HAVE arrived", () => {
    const levers = normalizeRegisterLevers({ space: "privacy" });
    expect(registerLeverChips(levers)).toEqual([
      { label: "Space", value: "Privacy" },
    ]);
  });

  it("ignores a value outside the page's vocabulary", () => {
    expect(
      normalizeRegisterLevers({ space: "finance", attention: "on_fire" }),
    ).toMatchObject({ space: null, attention: null });
  });
});

describe("parseTopLever refuses rather than coerces", () => {
  it.each([
    ["0", null],
    ["-3", null],
    ["abc", null],
    ["2.5", null],
    ["1e3", null],
    ["+5", null],
    ["", null],
    ["  ", null],
    ["10", 10],
    [" 7 ", 7],
  ])("reads %o as %o", (raw, expected) => {
    expect(parseTopLever(raw)).toBe(expected);
  });

  it("reads a nullish limit as absent", () => {
    // Passed as its own case, not through it.each — `it.each` SPREADS array rows,
    // so a row holding `undefined` runs with no argument at all and silently
    // duplicates a neighbouring case.
    expect(parseTopLever(null)).toBeNull();
    expect(parseTopLever(undefined)).toBeNull();
  });
});

describe("the chips and the URL come off ONE record", () => {
  it("round-trips a full lever set through the query string", () => {
    const levers = normalizeRegisterLevers({
      space: "clinical",
      attention: "review_overdue",
      sort: "coverage_asc",
      top: 5,
    });
    const query = registerLeverQuery(levers);
    expect(readRegisterLevers(new URLSearchParams(query))).toEqual(levers);
  });

  it("draws one chip per set lever, in control order", () => {
    const levers = normalizeRegisterLevers({
      space: "vendor",
      attention: "attestation_short",
      sort: "ref_asc",
      top: 3,
    });
    expect(registerLeverChips(levers).map((c) => c.label)).toEqual([
      "Space",
      "Attention",
      "Sort",
      "Top",
    ]);
  });
});

describe("applyRegisterLevers", () => {
  it("publishes matching and visible as two DIFFERENT numbers", () => {
    // A caption whose denominator is the unfiltered total reads "Top 2 of 9"
    // against 3 matching rows — the one number the room is asked to read as
    // proof of the maneuver instead says the filters did nothing.
    const levers = normalizeRegisterLevers({ space: "privacy", top: 2 });
    const view = applyRegisterLevers(records(), levers, NOW);
    expect(view.total).toBe(9);
    expect(view.matching).toBe(3);
    expect(view.visible).toBe(2);
    expect(view.rows).toHaveLength(2);
  });

  it("filters on an attention class the row CARRIES, not on an exclusive bucket", () => {
    const view = applyRegisterLevers(
      records(),
      normalizeRegisterLevers({ attention: "unendorsed_revision" }),
      NOW,
    );
    expect(view.rows.map((r) => r.ref).sort()).toEqual(["POL-114", "POL-208"]);
  });

  it("leaves several rows for every single-lever pull", () => {
    for (const space of ["privacy", "clinical", "vendor"]) {
      const view = applyRegisterLevers(
        records(),
        normalizeRegisterLevers({ space }),
        NOW,
      );
      expect(view.matching).toBeGreaterThan(1);
    }
    for (const attention of [
      "review_overdue",
      "attestation_short",
      "unendorsed_revision",
    ]) {
      const view = applyRegisterLevers(
        records(),
        normalizeRegisterLevers({ attention }),
        NOW,
      );
      expect(view.matching).toBeGreaterThan(1);
    }
  });

  it("sorts most-overdue first under review_due_asc", () => {
    const view = applyRegisterLevers(
      records(),
      normalizeRegisterLevers({ sort: "review_due_asc" }),
      NOW,
    );
    const dues = view.rows.map((r) => r.reviewDue);
    expect([...dues].sort()).toEqual(dues);
  });

  it("places the UNMEASURABLE row explicitly under coverage_asc — after short, before clear", () => {
    const view = applyRegisterLevers(
      records(),
      normalizeRegisterLevers({ sort: "coverage_asc" }),
      NOW,
    );
    const refs = view.rows.map((r) => r.ref);
    // STD-045 is the worst measurable coverage (56%); POL-311 is unmeasurable;
    // POL-302 is at 100%.
    expect(refs.indexOf("STD-045")).toBeLessThan(refs.indexOf("POL-311"));
    expect(refs.indexOf("POL-311")).toBeLessThan(refs.indexOf("POL-302"));
  });

  it("does not reorder the caller's array in place", () => {
    const rows = records();
    const before = rows.map((r) => r.ref);
    applyRegisterLevers(
      rows,
      normalizeRegisterLevers({ sort: "coverage_asc" }),
      NOW,
    );
    expect(rows.map((r) => r.ref)).toEqual(before);
  });

  it("applies no sort at all when the lever was not pulled", () => {
    const rows = records();
    const view = applyRegisterLevers(rows, normalizeRegisterLevers({}), NOW);
    expect(view.rows.map((r) => r.ref)).toEqual(rows.map((r) => r.ref));
  });
});
