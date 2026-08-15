import { describe, it, expect } from "vitest";
import {
  ANY_LEVER,
  CABIN_ARGUMENTS,
  CABIN_FILTERS,
  DEPARTURE_WINDOWS,
  DEPARTURE_WINDOW_RANGES,
  OPTION_SORTS,
  SORT_ARGUMENTS,
  STOPS_ARGUMENTS,
  STOP_FILTERS,
  WINDOW_ARGUMENTS,
  leverChips,
  leverQuery,
  normalizeLevers,
  parseTopLever,
  readLevers,
} from "./rebooking-levers";

describe("the departure windows tile the day", () => {
  it("assigns every hour to exactly one window", () => {
    // A gap here would be an hour of the day no window matches, so an option
    // departing in it would vanish from every filtered view and appear only in
    // the unfiltered one — a lever that silently hides rows.
    for (let hour = 0; hour < 24; hour++) {
      const matching = DEPARTURE_WINDOWS.filter((w) => {
        const range = DEPARTURE_WINDOW_RANGES[w];
        return hour >= range.fromHour && hour < range.toHour;
      });
      expect(matching).toHaveLength(1);
    }
  });
});

describe("every lever advertises the sentinel plus the page's vocabulary", () => {
  it("puts the not-pulled value first, and nothing else extra", () => {
    // The lever parameters are REQUIRED on the tool schema, so the model needs a
    // value that MEANS "no filter". Omission is not a choice it can state.
    expect(WINDOW_ARGUMENTS).toEqual([ANY_LEVER, ...DEPARTURE_WINDOWS]);
    expect(STOPS_ARGUMENTS).toEqual([ANY_LEVER, ...STOP_FILTERS]);
    expect(CABIN_ARGUMENTS).toEqual([ANY_LEVER, ...CABIN_FILTERS]);
    expect(SORT_ARGUMENTS).toEqual([ANY_LEVER, ...OPTION_SORTS]);
  });
});

describe("normalizeLevers", () => {
  it("drops the sentinel to null, so it draws no chip and writes no param", () => {
    const levers = normalizeLevers({
      window: ANY_LEVER,
      stops: ANY_LEVER,
      cabin: ANY_LEVER,
      sort: ANY_LEVER,
      top: 0,
    });
    expect(levers).toEqual({
      window: null,
      stops: null,
      cabin: null,
      sort: null,
      top: null,
    });
    expect(leverChips(levers)).toEqual([]);
    expect(leverQuery(levers)).toBe("");
  });

  it("drops junk rather than defaulting it", () => {
    // A `?? "all"` here would assert a choice the agent never made — and then
    // flip when the streamed value arrived.
    const levers = normalizeLevers({
      window: "midnight",
      stops: 3,
      cabin: "first",
      sort: null,
      top: "abc",
    });
    expect(levers).toEqual({
      window: null,
      stops: null,
      cabin: null,
      sort: null,
      top: null,
    });
  });

  it("keeps every value the page can honour", () => {
    const levers = normalizeLevers({
      window: "evening",
      stops: "nonstop",
      cabin: "economy",
      sort: "price_asc",
      top: "5",
    });
    expect(levers).toEqual({
      window: "evening",
      stops: "nonstop",
      cabin: "economy",
      sort: "price_asc",
      top: 5,
    });
  });
});

describe("parseTopLever refuses rather than coercing", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["0", null],
    ["-3", null],
    ["2.5", null],
    ["1e3", null],
    ["+5", null],
    ["10px", null],
    ["ten", null],
    ["5", 5],
    ["  12 ", 12],
  ])("%s → %s", (raw, expected) => {
    expect(parseTopLever(raw)).toBe(expected);
  });

  it("treats an unusable value as an ABSENT lever, not a one-row list", () => {
    // Commerce's `Math.max(1, Number(raw) || 0)` turned every bad value into a
    // one-row view, which on stage is indistinguishable from a working filter.
    expect(parseTopLever("-3")).toBeNull();
    expect(parseTopLever(null)).toBeNull();
    expect(parseTopLever(undefined)).toBeNull();
  });
});

describe("chips and the query string come off ONE record", () => {
  const levers = normalizeLevers({
    window: "evening",
    stops: "nonstop",
    cabin: "economy",
    sort: "price_asc",
    top: 5,
  });

  it("draws one chip per lever that was actually set, in control order", () => {
    expect(leverChips(levers).map((c) => c.label)).toEqual([
      "Departs",
      "Stops",
      "Cabin",
      "Sort",
      "Top",
    ]);
  });

  it("draws no chip for a lever nobody set", () => {
    const partial = normalizeLevers({ window: "evening", top: 3 });
    expect(partial.stops).toBeNull();
    expect(partial.sort).toBeNull();
    expect(partial.cabin).toBeNull();
    expect(leverChips(partial).map((c) => c.label)).toEqual(["Departs", "Top"]);
  });

  it("round-trips through the query string", () => {
    // The view the confirm card opens has to be the view the card just
    // promised, so both are built from the same record and read back into it.
    expect(readLevers(new URLSearchParams(leverQuery(levers)))).toEqual(levers);
  });

  it("writes no param for an unset lever", () => {
    const query = leverQuery(normalizeLevers({ window: "morning" }));
    expect(query).toBe("window=morning");
  });
});
