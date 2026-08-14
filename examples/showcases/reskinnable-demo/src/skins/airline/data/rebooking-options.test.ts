import { describe, it, expect, beforeEach } from "vitest";
import * as store from "./store";
import { normalizeLevers } from "./rebooking-levers";
import {
  applyLevers,
  departureWindowOf,
  findOption,
  localHourOf,
  optionsForBooking,
  stopBucketOf,
} from "./rebooking-options";
import type { RebookingOption } from "./trip-types";

beforeEach(() => store.reset());

/** Beat 3c's own lever set, exactly as the pill will send it. */
const BEAT_3C = normalizeLevers({
  window: "evening",
  stops: "nonstop",
  sort: "price_asc",
  top: 5,
});

const homeward = () => optionsForBooking(store.options(), "bkg-av1466");

describe("localHourOf reads the AIRPORT's clock, not the process's", () => {
  it("takes the hour out of the ISO string", () => {
    // `new Date(iso).getHours()` answers in whatever timezone the process runs
    // in, so an evening departure from Lima would filter as an afternoon one on
    // a CI box in another zone.
    expect(localHourOf("2026-07-21T18:20:00-05:00")).toBe(18);
    expect(localHourOf("2026-07-21T18:20:00+09:00")).toBe(18);
    expect(localHourOf("2026-07-21T00:05:00Z")).toBe(0);
  });

  it("refuses what it cannot read rather than reading it as midnight", () => {
    expect(localHourOf("")).toBeNull();
    expect(localHourOf("tomorrow evening")).toBeNull();
    expect(localHourOf("21/07/2026 18:20")).toBeNull();
  });
});

describe("bucketing", () => {
  const option = (over: Partial<RebookingOption>): RebookingOption => ({
    ...homeward()[0],
    ...over,
  });

  it("assigns a window from the departure hour", () => {
    expect(
      departureWindowOf(
        option({ departureLocal: "2026-07-21T06:45:00-05:00" }),
      ),
    ).toBe("morning");
    expect(
      departureWindowOf(
        option({ departureLocal: "2026-07-21T12:00:00-05:00" }),
      ),
    ).toBe("afternoon");
    expect(
      departureWindowOf(
        option({ departureLocal: "2026-07-21T18:00:00-05:00" }),
      ),
    ).toBe("evening");
  });

  it("gives an unreadable departure no window, so it matches no filter", () => {
    expect(departureWindowOf(option({ departureLocal: "soon" }))).toBeNull();
  });

  it("buckets stops", () => {
    expect(stopBucketOf(option({ stops: 0 }))).toBe("nonstop");
    expect(stopBucketOf(option({ stops: 1 }))).toBe("one_stop");
    expect(stopBucketOf(option({ stops: 2 }))).toBe("two_plus");
    expect(stopBucketOf(option({ stops: 4 }))).toBe("two_plus");
    expect(stopBucketOf(option({ stops: -1 }))).toBe("nonstop");
  });
});

describe("applyLevers publishes BOTH lengths from one pipeline", () => {
  it("filters, then truncates — and reports each separately", () => {
    // Commerce shipped a "Top 10 of 22" caption whose denominator came from the
    // unfiltered collection while 13 rows matched, so the one number the room is
    // asked to read as proof of the maneuver said the filters did nothing.
    const { matching, visible } = applyLevers(homeward(), BEAT_3C);
    expect(visible.length).toBeLessThan(matching.length);
    expect(matching.length).toBeLessThan(homeward().length);
    expect(visible).toEqual(matching.slice(0, 5));
  });

  it("leaves several rows under beat 3c's own filter — a FAT board", () => {
    // Logistics: "a one-row board is indistinguishable from a broken filter on
    // stage." Asserted against the number the seed actually carries, so a reseed
    // that thins the board fails here instead of on stage.
    const { matching } = applyLevers(homeward(), BEAT_3C);
    expect(matching.length).toBe(10);
    expect(matching.length).toBeGreaterThanOrEqual(5);
  });

  it("sorts cheapest first when that lever is pulled", () => {
    const { matching } = applyLevers(homeward(), BEAT_3C);
    const prices = matching.map((o) => o.fareDifferenceUsd);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it("sorts by departure and by duration too", () => {
    const soonest = applyLevers(
      homeward(),
      normalizeLevers({ sort: "depart_soonest" }),
    ).matching;
    expect(soonest[0].departureLocal <= soonest[1].departureLocal).toBe(true);

    const shortest = applyLevers(
      homeward(),
      normalizeLevers({ sort: "duration_asc" }),
    ).matching;
    expect(shortest[0].durationMinutes).toBeLessThanOrEqual(
      shortest[shortest.length - 1].durationMinutes,
    );
  });

  it("leaves the seed order alone when no sort was asked for", () => {
    const all = homeward();
    expect(applyLevers(all, normalizeLevers({})).matching).toEqual(all);
  });

  it("does not sort the store in place", () => {
    const before = store.options().map((o) => o.id);
    applyLevers(homeward(), normalizeLevers({ sort: "price_asc" }));
    expect(store.options().map((o) => o.id)).toEqual(before);
  });

  it("honours every lever value the schema advertises", () => {
    // A lever value the view does not honour is a chip the confirm card draws
    // over a filter that does nothing. Walked rather than spot-checked.
    for (const window of ["morning", "afternoon", "evening"] as const) {
      expect(
        applyLevers(homeward(), normalizeLevers({ window })).matching.length,
      ).toBeGreaterThan(0);
    }
    for (const stops of ["nonstop", "one_stop", "two_plus"] as const) {
      expect(
        applyLevers(homeward(), normalizeLevers({ stops })).matching.length,
      ).toBeGreaterThan(0);
    }
    for (const cabin of ["economy", "premium", "business"] as const) {
      expect(
        applyLevers(homeward(), normalizeLevers({ cabin })).matching.length,
      ).toBeGreaterThan(0);
    }
  });
});

describe("lookups", () => {
  it("scopes options to their booking", () => {
    expect(homeward().every((o) => o.bookingId === "bkg-av1466")).toBe(true);
    expect(homeward().length).toBe(30);
  });

  it("finds an option by id and misses cleanly", () => {
    expect(findOption(store.options(), "o-1478-e")?.flightNumber).toBe(
      "AV1478",
    );
    expect(findOption(store.options(), "o-nope")).toBeUndefined();
  });

  it("gives every option somewhere to sit", () => {
    // A reissue with an empty seat pool makes beat 5's reseat step refuse
    // mid-demo, which looks exactly like a bug in the reseat write.
    expect(store.options().every((o) => o.availableSeats.length > 0)).toBe(
      true,
    );
  });
});
