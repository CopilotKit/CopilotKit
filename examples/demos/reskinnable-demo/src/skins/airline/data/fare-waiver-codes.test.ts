import { describe, it, expect } from "vitest";
import {
  FARE_WAIVER_CODES,
  FARE_WAIVER_CODE_LABELS,
  exceptionLifts,
  isJustifyingExceptionCode,
  isValidExceptionCode,
} from "./fare-waiver-codes";
import { NOTICE_TEMPLATES, NOTIFY_PARTIES, SEAT_PREFERENCES } from "./handling";

const JUSTIFYING = [
  "SCHEDULE_CHANGE_TRIGGERED",
  "MEDICAL_DOCUMENTED",
  "BEREAVEMENT_DOCUMENTED",
  "MILITARY_ORDERS",
] as const;

const DECOYS = ["CHANGED_PLANS", "FOUND_LOWER_FARE", "ELITE_COURTESY"] as const;

describe("the fare waiver catalogue", () => {
  it("is exactly four justifying categories and three decoys", () => {
    // Restated here rather than derived from the module, so a change to the
    // split is a failing test rather than a test that agrees with itself.
    expect([...FARE_WAIVER_CODES].sort()).toEqual(
      [...JUSTIFYING, ...DECOYS].sort(),
    );
    for (const code of JUSTIFYING) {
      expect(isJustifyingExceptionCode(code)).toBe(true);
    }
    for (const code of DECOYS) {
      expect(isJustifyingExceptionCode(code)).toBe(false);
    }
  });

  it("labels every category, and labels nothing else", () => {
    expect(Object.keys(FARE_WAIVER_CODE_LABELS).sort()).toEqual(
      [...FARE_WAIVER_CODES].sort(),
    );
  });

  it("does NOT group the justifying categories together in the array", () => {
    // The human-facing form renders this array in order, unmarked. Grouping
    // would turn the demonstration into a guided tour: the passenger is supposed
    // to know which category applies, and an app that lays them out in two
    // blocks tells them.
    const firstDecoy = FARE_WAIVER_CODES.findIndex((c) =>
      (DECOYS as readonly string[]).includes(c),
    );
    const lastJustifying = FARE_WAIVER_CODES.reduce(
      (last, code, i) =>
        (JUSTIFYING as readonly string[]).includes(code) ? i : last,
      -1,
    );
    expect(firstDecoy).toBeLessThan(lastJustifying);
  });

  it("rejects an uncatalogued code", () => {
    expect(isValidExceptionCode("SCHEDULE_CHANGE")).toBe(false);
    expect(isValidExceptionCode("")).toBe(false);
    expect(isValidExceptionCode("schedule_change_triggered")).toBe(false);
  });
});

describe("grounding — a category alone does not lift anything", () => {
  it("lifts only when the category matches the booking's documented ground", () => {
    expect(exceptionLifts("SCHEDULE_CHANGE_TRIGGERED", "schedule_change")).toBe(
      true,
    );
    expect(exceptionLifts("MEDICAL_DOCUMENTED", "medical")).toBe(true);
    expect(exceptionLifts("BEREAVEMENT_DOCUMENTED", "bereavement")).toBe(true);
    expect(exceptionLifts("MILITARY_ORDERS", "military")).toBe(true);
  });

  it("REFUSES a justifying category on the wrong ground", () => {
    // This is what makes the two taught cases genuinely unlike each other.
    // Without it, a demonstration on the schedule-change booking replays on the
    // medical one as a memorized literal and the "unaided" claim is theater.
    expect(exceptionLifts("SCHEDULE_CHANGE_TRIGGERED", "medical")).toBe(false);
    expect(exceptionLifts("MEDICAL_DOCUMENTED", "schedule_change")).toBe(false);
    expect(exceptionLifts("MILITARY_ORDERS", "bereavement")).toBe(false);
  });

  it("lifts NOTHING on a booking that documents nothing — for any category", () => {
    // The seeded `bkg-av1188` case. This is what makes the decoys real rather
    // than theoretical: on that booking every category in the catalogue files
    // honestly and releases nothing.
    for (const code of FARE_WAIVER_CODES) {
      expect(exceptionLifts(code, null)).toBe(false);
    }
  });

  it("lifts nothing under a decoy, on any ground", () => {
    for (const code of DECOYS) {
      for (const ground of [
        "schedule_change",
        "medical",
        "bereavement",
        "military",
      ] as const) {
        expect(exceptionLifts(code, ground)).toBe(false);
      }
    }
  });

  it("lifts nothing under an uncatalogued code", () => {
    expect(exceptionLifts("SCHEDULE_CHANGE", "schedule_change")).toBe(false);
    expect(exceptionLifts("", "medical")).toBe(false);
  });
});

describe("the two vocabularies share no token", () => {
  // BEAT 5's vocabulary is GIVEN to the agent; beat 6's is WITHHELD. They live
  // in two modules so a future edit reaching for "the codes file" cannot pull
  // the withheld one into `tools.tsx`. A shared word would make that mistake
  // easy to make and hard to see, so it is checked rather than asserted in prose.
  const wordsOf = (values: readonly string[]) =>
    new Set(
      values.flatMap((v) =>
        v
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter(Boolean),
      ),
    );

  it("neither file's vocabulary reuses a word from the other", () => {
    const withheld = wordsOf(FARE_WAIVER_CODES);
    const given = wordsOf([
      ...NOTIFY_PARTIES,
      ...NOTICE_TEMPLATES,
      ...SEAT_PREFERENCES,
    ]);
    const shared = [...withheld].filter((word) => given.has(word));
    expect(shared).toEqual([]);
  });
});
