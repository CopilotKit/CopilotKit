// The channel demo booker's day tabs and pages of times (shell-docs
// src/lib/early-access/slot-days.ts), in the reader's time zone.
import { describe, expect, test } from "vitest";

import {
  SLOT_LEAD_MS,
  groupSlotDays,
  keptOut,
  pageTimes,
  tooSoon,
} from "../../../shell-docs/src/lib/early-access/slot-days";
import type { TimeChip } from "../../../shell-docs/src/lib/early-access/slot-days";

const live = (starts: string[], unavailable: string[] = []) => ({
  status: "live" as const,
  slots: starts.map((startTime) => ({ startTime })),
  unavailable: unavailable.map((startTime) => ({ startTime })),
});

const NONE = new Set<number>();

describe("groupSlotDays", () => {
  test("the repeated hour of a clock change gets the zone on both copies", () => {
    // Egypt leaves summer time at midnight on October 29, 2026: 23:00 to
    // 23:59 happen twice, first at UTC+3, then at UTC+2.
    const starts = [
      "2026-10-29T20:00:00Z",
      "2026-10-29T20:30:00Z",
      "2026-10-29T21:00:00Z",
      "2026-10-29T21:30:00Z",
    ];
    const [day] = groupSlotDays(
      live(starts),
      "Africa/Cairo",
      Date.parse("2026-10-28T00:00:00Z"),
      NONE,
    );
    const times = day.times.map((chip) => chip.time);
    expect(new Set(times).size).toBe(4);
    for (const chip of day.times) {
      expect(chip.time).toMatch(/^11:[03]0 PM \S+/);
      expect(chip.label.startsWith(chip.time)).toBe(true);
    }
    // Times that don't repeat keep the plain clock.
    const [plain] = groupSlotDays(
      live(["2026-10-28T08:00:00Z"]),
      "Africa/Cairo",
      Date.parse("2026-10-27T00:00:00Z"),
      NONE,
    );
    expect(plain.times[0].time).toBe("11:00 AM");
  });

  test("a half-hour zone groups and labels by its own day", () => {
    // 18:30Z is midnight in India (UTC+5:30): the next day there.
    const days = groupSlotDays(
      live(["2026-12-01T18:00:00Z", "2026-12-01T18:30:00Z"]),
      "Asia/Kolkata",
      Date.parse("2026-11-30T00:00:00Z"),
      NONE,
    );
    expect(days.map((d) => d.key)).toEqual(["2026-12-01", "2026-12-02"]);
    expect(days[0].times[0].time).toBe("11:30 PM");
    expect(days[1].times[0].time).toBe("12:00 AM");
    expect(days[1].label).toBe("Wednesday, December 2");
  });

  test("times inside the lead, and taken ones, are not offered", () => {
    const now = Date.parse("2026-12-02T16:00:00Z");
    const starts = [
      "2026-12-02T16:04:00Z", // inside the five-minute lead
      "2026-12-02T16:30:00Z",
      "2026-12-02T17:00:00Z",
      "2026-12-02T17:30:00Z",
    ];
    const taken = new Set([Date.parse("2026-12-02T17:00:00Z")]);
    const [day] = groupSlotDays(live(starts), "UTC", now, taken);
    expect(SLOT_LEAD_MS).toBe(5 * 60_000);
    expect(day.times.map((c) => [c.time, c.available])).toEqual([
      ["4:30 PM", true],
      ["5:00 PM", false],
      ["5:30 PM", true],
    ]);
  });

  test("shows the first five days with open times", () => {
    const starts = Array.from(
      { length: 7 },
      (_, i) => `2026-12-0${i + 1}T17:00:00Z`,
    );
    const days = groupSlotDays(
      live(starts),
      "UTC",
      Date.parse("2026-11-30T00:00:00Z"),
      NONE,
    );
    expect(days.map((d) => d.key)).toEqual([
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
      "2026-12-04",
      "2026-12-05",
    ]);
  });
});

const open = (n: number): TimeChip => ({
  available: true,
  startTime: "",
  startMs: n,
  time: `${n}`,
  label: `${n}`,
  heading: `${n}`,
});
const closed = (n: number): TimeChip => ({
  available: false,
  startMs: n,
  time: `${n}`,
  label: `${n}`,
});

describe("pageTimes", () => {
  test("pages of eight with at most three closed times, none all closed", () => {
    const chips = [
      open(1),
      closed(2),
      closed(3),
      closed(4),
      closed(5),
      open(6),
      open(7),
      open(8),
      open(9),
      open(10),
      closed(11),
      closed(12),
    ];
    const pages = pageTimes(chips, 8);
    expect(pages.map((page) => page.map((e) => e.chip.startMs))).toEqual([
      [1, 2, 3, 4, 6, 7, 8, 9],
      [10, 11, 12],
    ]);
    expect(pages[1].map((e) => e.slotIndex)).toEqual([5, -1, -1]);
    expect(pageTimes([closed(1), closed(2)], 8)).toEqual([]);
  });
});

describe("tooSoon", () => {
  test("a time is too soon to book from the start of the lead", () => {
    const now = Date.parse("2026-12-02T16:00:00Z");
    expect(tooSoon({ startMs: now + SLOT_LEAD_MS }, now)).toBe(true);
    expect(tooSoon({ startMs: now + SLOT_LEAD_MS + 1 }, now)).toBe(false);
  });
});

describe("keptOut", () => {
  test("a taken time stays out of times read before its hold ends", () => {
    // 1 was booked (for good); 2 was taken by someone else, held to 120000.
    const taken = new Map([
      [1, Infinity],
      [2, 120_000],
    ]);
    expect([...keptOut(taken, 119_999)]).toEqual([1, 2]);
    expect([...keptOut(taken, 120_000)]).toEqual([1]);
    expect([...keptOut(new Map(), 0)]).toEqual([]);
  });
});
