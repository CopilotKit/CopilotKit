/**
 * The shopper's book club — the seeded operational procedure of demo beat 5.
 *
 * ONE club, no switcher: a second club would imply a per-club memory scope this
 * app cannot demonstrate (see the CAVEAT block in `.env.example`).
 *
 * The meeting DATE is deliberately not stored. A hardcoded ISO date is a demo
 * that rots silently — right this month, absurd next year, and nothing fails.
 * `nextMeetingDate` derives it from a weekday instead, and takes `from` as a
 * parameter rather than reading the clock so it is unit-testable.
 */
export interface BookClub {
  name: string;
  /** Which WORK is this month's pick — matches `Book.workId`, not `Book.id`. */
  pickWorkId: string;
  promoCode: string;
  discountPercent: number;
  /** 0 = Sunday … 6 = Saturday. 4 = Thursday. */
  meetsOnWeekday: number;
}

export const BOOKSTORE_CLUB: BookClub = Object.freeze({
  name: "The Thursday Club",
  pickWorkId: "trust",
  promoCode: "CLUB15",
  discountPercent: 15,
  meetsOnWeekday: 4,
});

/**
 * The next occurrence of `weekday`, counting today as valid.
 *
 * When today IS the meeting day this returns TODAY, not next week: the club
 * meets tonight, so "deliver before the meeting" is same-day and the demo still
 * reads correctly. Returns a NEW Date; never mutates `from`.
 */
export function nextMeetingDate(weekday: number, from: Date): Date {
  const out = new Date(from.getTime());
  const delta = (weekday - out.getUTCDay() + 7) % 7;
  out.setUTCDate(out.getUTCDate() + delta);
  return out;
}

/** `nextMeetingDate` as a `YYYY-MM-DD` string — what `setDeliveryBy` takes. */
export function nextMeetingISO(weekday: number, from: Date): string {
  return nextMeetingDate(weekday, from).toISOString().slice(0, 10);
}

/**
 * A UTC-midnight `Date` whose `getUTCDay()` equals the CALLER'S LOCAL
 * weekday — so it is the input `nextMeetingDate`/`nextMeetingISO` need when a
 * caller has a wall-clock "now" rather than a UTC one.
 *
 * Why this exists: `nextMeetingDate`/`nextMeetingISO` are, and deliberately
 * stay, UTC-only (`getUTCDay`/`setUTCDate`/`toISOString`) — that keeps their
 * behavior pinned regardless of the machine running them, which is what the
 * existing test suite locks in. But an agent readable that wants "what day is
 * it for the presenter" naturally reaches for `new Date()`, i.e. LOCAL wall
 * time. West of UTC that pairing breaks: at UTC-8, Thursday 17:00 local is
 * already `Friday 01:00` UTC, so `getUTCDay()` on that instant reports Friday
 * while the presenter is still living Thursday. Feeding that straight into
 * `nextMeetingDate` would silently skip tonight's meeting and compute next
 * Thursday instead. This helper re-anchors the LOCAL calendar day
 * (`getFullYear`/`getMonth`/`getDate`, all local) onto UTC midnight, so its
 * `getUTCDay()` agrees with the caller's local weekday and the UTC-only
 * functions above stay correct for callers on any wall clock.
 */
export function localCalendarDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
