import { describe, expect, it } from "vitest";
import {
  BOOKSTORE_CLUB,
  localCalendarDay,
  nextMeetingDate,
  nextMeetingISO,
} from "./club";

const at = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

/**
 * A Date-like stand-in whose LOCAL getters (`getFullYear`/`getMonth`/
 * `getDate` — the only ones `localCalendarDay` reads) report a chosen
 * wall-clock day, without mutating `process.env.TZ` (a real timezone flip is
 * a process-global that would leak into every other test file running in the
 * same worker). `month` is 0-indexed, matching `Date`.
 */
function fakeLocalDate(year: number, month: number, date: number): Date {
  return {
    getFullYear: () => year,
    getMonth: () => month,
    getDate: () => date,
  } as Date;
}

describe("BOOKSTORE_CLUB", () => {
  it("names one club, its pick, its code and its meeting weekday", () => {
    expect(BOOKSTORE_CLUB.name).toBe("The Thursday Club");
    expect(BOOKSTORE_CLUB.pickWorkId).toBe("trust");
    expect(BOOKSTORE_CLUB.promoCode).toBe("CLUB15");
    expect(BOOKSTORE_CLUB.discountPercent).toBe(15);
    expect(BOOKSTORE_CLUB.meetsOnWeekday).toBe(4); // Thursday
  });
});

describe("nextMeetingDate", () => {
  // 2026-08-11 is a Tuesday (getUTCDay() === 2).
  it("finds the next Thursday from a Tuesday", () => {
    expect(nextMeetingISO(4, at("2026-08-11"))).toBe("2026-08-13");
  });

  it("returns TODAY when today IS the meeting day", () => {
    // The club meets tonight; 'deliver before the meeting' is same-day.
    expect(nextMeetingISO(4, at("2026-08-13"))).toBe("2026-08-13");
  });

  it("wraps to next week when the day has just passed", () => {
    expect(nextMeetingISO(4, at("2026-08-14"))).toBe("2026-08-20"); // Friday → next Thu
  });

  it("crosses a month boundary", () => {
    expect(nextMeetingISO(4, at("2026-08-28"))).toBe("2026-09-03");
  });

  it("crosses a year boundary", () => {
    expect(nextMeetingISO(4, at("2027-01-01"))).toBe("2027-01-07"); // 2027-01-01 is a Friday
  });

  it("handles every weekday without throwing, always within 7 days", () => {
    const from = at("2026-08-11");
    for (let w = 0; w < 7; w++) {
      const d = nextMeetingDate(w, from);
      const days = Math.round((d.getTime() - from.getTime()) / 86_400_000);
      expect(days).toBeGreaterThanOrEqual(0);
      expect(days).toBeLessThan(7);
      expect(d.getUTCDay()).toBe(w);
    }
  });

  it("does not mutate the date it was given", () => {
    const from = at("2026-08-11");
    const before = from.getTime();
    nextMeetingDate(4, from);
    expect(from.getTime()).toBe(before);
  });
});

describe("localCalendarDay", () => {
  // 2026-08-13 is a Thursday (see nextMeetingDate tests above). At UTC-8,
  // Thursday 17:00 local is already 2026-08-14T01:00Z — Friday in UTC — which
  // is exactly the west-of-UTC case this helper exists to fix.
  it("reports the LOCAL weekday via getUTCDay(), not the UTC weekday of that same negative-offset instant", () => {
    const localThursday = fakeLocalDate(2026, 7, 13); // August is month 7 (0-indexed)
    expect(localCalendarDay(localThursday).getUTCDay()).toBe(4); // Thursday

    // Sanity check on the bug this replaces: the real UTC-8 instant for that
    // local wall time lands on UTC Friday (5), one day later.
    expect(new Date("2026-08-13T17:00:00-08:00").getUTCDay()).toBe(5);
  });

  it("returns an instant that is exactly midnight UTC", () => {
    const day = localCalendarDay(fakeLocalDate(2026, 7, 13));
    expect(day.getUTCHours()).toBe(0);
    expect(day.getUTCMinutes()).toBe(0);
    expect(day.getUTCSeconds()).toBe(0);
    expect(day.getUTCMilliseconds()).toBe(0);
  });

  it("never yields a club date in the past, for every weekday", () => {
    const today = localCalendarDay(fakeLocalDate(2026, 7, 13));
    const floor = today.toISOString().slice(0, 10);
    for (let w = 0; w < 7; w++) {
      expect(nextMeetingISO(w, today) >= floor).toBe(true);
    }
  });
});
