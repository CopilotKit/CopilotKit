/**
 * BEAT 3c — the lever record, guarded at the layer everything else reads.
 *
 * The page's render guard (`pages/on-screen-readables.test.tsx`) proves the rows
 * the readable claims ARE the rows the board painted. This file proves the layer
 * beneath it: that a lever the page has no control for is dropped rather than
 * carried, that an unset lever stays unset rather than defaulting to something
 * the agent never chose, and that the chips and the URL come out of the same
 * record. Those are the two commerce-era failures named in the module header.
 */
import { describe, expect, it } from "vitest";
import {
  ANY_LEVER,
  EXCEPTION_ARGUMENTS,
  EXCEPTION_FILTERS,
  EXCEPTION_SORTS,
  SORT_ARGUMENTS,
  STATUS_ARGUMENTS,
  STATUS_FILTERS,
  leverChips,
  leverQuery,
  normalizeLevers,
  parseTopLever,
  readLevers,
} from "@/skins/logistics/data/exception-levers";

describe("parseTopLever", () => {
  it("accepts a positive integer", () => {
    expect(parseTopLever("10")).toBe(10);
  });
  it("refuses zero, negatives, fractions and junk rather than coercing", () => {
    for (const bad of ["0", "-5", "2.5", "1e3", "ten", "", null]) {
      expect(parseTopLever(bad)).toBeNull();
    }
  });
});

describe("normalizeLevers", () => {
  it("drops a value the page has no control for", () => {
    expect(
      normalizeLevers({ exception: "not_a_real_code" }).exception,
    ).toBeNull();
    expect(normalizeLevers({ sort: "by_vibes" }).sort).toBeNull();
  });
  it("keeps every value the page DOES have a control for", () => {
    for (const e of EXCEPTION_FILTERS) {
      expect(normalizeLevers({ exception: e }).exception).toBe(e);
    }
    for (const s of STATUS_FILTERS) {
      expect(normalizeLevers({ status: s }).status).toBe(s);
    }
    for (const s of EXCEPTION_SORTS) {
      expect(normalizeLevers({ sort: s }).sort).toBe(s);
    }
  });
  it("treats the ANY_LEVER sentinel as 'not pulled', not as a filter", () => {
    // The tool advertises `"all"` and `0` so the model can SAY "no filter" —
    // optional parameters it simply fills anyway, which is how an invented
    // exception+status pair once put an empty board on screen. The sentinels are
    // not in the page's control vocabulary, so they fall out here.
    const levers = normalizeLevers({
      exception: ANY_LEVER,
      status: ANY_LEVER,
      sort: ANY_LEVER,
      top: 0,
    });
    expect(levers).toEqual({
      exception: null,
      status: null,
      sort: null,
      top: null,
    });
    expect(leverChips(levers)).toEqual([]);
    expect(leverQuery(levers)).toBe("");
  });

  it("keeps the sentinel OUT of every page vocabulary", () => {
    // THE property the sentinel design rests on. `"all"` is dropped by the very
    // same `normalizeLevers` branch that drops `sort=by_vibes` — no downstream
    // code branches on it — and that holds only while it is not a value the page
    // has a control for. The day someone adds a real filter literally named
    // "all", every lever silently becomes unsettable.
    const vocabularies = {
      EXCEPTION_FILTERS,
      STATUS_FILTERS,
      EXCEPTION_SORTS,
    } as Record<string, readonly string[]>;
    for (const [name, values] of Object.entries(vocabularies)) {
      expect(
        values,
        `${name} must not contain the ANY_LEVER sentinel`,
      ).not.toContain(ANY_LEVER);
    }
    // …and the tool advertises the sentinel FIRST, ahead of every honourable
    // value, so a model scanning the enum sees the "leave it alone" option.
    expect(EXCEPTION_ARGUMENTS).toEqual([ANY_LEVER, ...EXCEPTION_FILTERS]);
    expect(STATUS_ARGUMENTS).toEqual([ANY_LEVER, ...STATUS_FILTERS]);
    expect(SORT_ARGUMENTS).toEqual([ANY_LEVER, ...EXCEPTION_SORTS]);
  });

  it("leaves an unset lever null rather than defaulting it", () => {
    // Args STREAM: the confirm card renders while `args` is half-empty. A
    // `?? "all"` default would assert a choice the agent never made, and then
    // flip when the real value arrives.
    expect(normalizeLevers({})).toEqual({
      exception: null,
      status: null,
      sort: null,
      top: null,
    });
  });
});

describe("leverChips", () => {
  it("gives an unset lever no chip at all", () => {
    expect(leverChips(normalizeLevers({ sort: "value_desc" }))).toEqual([
      { label: "Sort", value: "Highest value first" },
    ]);
  });
  it("draws one chip per set lever, in control order", () => {
    const chips = leverChips(
      normalizeLevers({
        exception: "CARRIER_DELAY",
        status: "delayed",
        sort: "value_desc",
        top: 10,
      }),
    );
    expect(chips.map((c) => c.label)).toEqual([
      "Exception",
      "Status",
      "Sort",
      "Top",
    ]);
    // Every chip carries a human label, never a raw enum and never `undefined`.
    for (const chip of chips) {
      expect(chip.value).toBeTruthy();
      expect(chip.value).not.toBe("undefined");
    }
  });
});

describe("leverQuery", () => {
  it("builds the URL from the same record the chips come from", () => {
    const levers = normalizeLevers({ exception: "CARRIER_DELAY", top: 10 });
    expect(leverQuery(levers)).toBe("exception=CARRIER_DELAY&top=10");
    expect(leverChips(levers)).toHaveLength(2);
  });
  it("round-trips through readLevers", () => {
    const levers = normalizeLevers({
      exception: "CARRIER_DELAY",
      status: "delayed",
      sort: "value_desc",
      top: 10,
    });
    expect(readLevers(new URLSearchParams(leverQuery(levers)))).toEqual(levers);
  });
  it("emits nothing for a lever set nobody chose", () => {
    expect(leverQuery(normalizeLevers({}))).toBe("");
  });
});
