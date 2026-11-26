import type { ChannelDemoTimes } from "./booking";

// Turns the proxy's open and unavailable times into the booker's day tabs and
// pages of times, in the reader's time zone. Ported from the website's
// demo-slot-days.ts (CopilotKit/website, the /clif booker).

/** Times closer than this are too soon to book, as on the website. */
export const SLOT_LEAD_MS = 5 * 60_000;

/** Whether a time is too soon to book by `now` (inside the lead). */
export const tooSoon = (time: { startMs: number }, now = Date.now()) =>
  time.startMs - now <= SLOT_LEAD_MS;

/** Day tabs: the next days with an open time. */
const DAYS = 5;

/** An open time: its clock, its accessible name, and the form's heading. */
export interface OpenTime {
  available: true;
  startTime: string;
  startMs: number;
  /**
   * "9:30 AM"; "11:00 PM GMT+3" for a clock time the day has twice (the
   * hour repeated when the clocks go back).
   */
  time: string;
  /** "9:30 AM, Tuesday, December 1". */
  label: string;
  /** "Tuesday, December 1 at 9:30 AM PST". */
  heading: string;
}

/** A time on the event's hours that isn't open: shown, never offered. */
export interface ClosedTime {
  available: false;
  startMs: number;
  time: string;
  label: string;
}

export type TimeChip = OpenTime | ClosedTime;

export interface SlotDay {
  /** "2026-12-01" in the reader's zone. */
  key: string;
  /** "Tue". */
  weekday: string;
  /** "Dec 1". */
  date: string;
  /** "Tuesday, December 1". */
  label: string;
  times: TimeChip[];
}

function formats(timeZone: string) {
  const make = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone, ...options });
  return {
    key: new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    weekday: make({ weekday: "short" }),
    date: make({ month: "short", day: "numeric" }),
    longDay: make({ weekday: "long", month: "long", day: "numeric" }),
    time: make({ hour: "numeric", minute: "2-digit" }),
    zonedTime: make({
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }),
    heading: make({
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }),
  };
}

/** A booked time, as the confirmation states it. */
export function formatBookedTime(startTime: string, timeZone: string) {
  const ms = Date.parse(startTime);
  return Number.isFinite(ms) ? formats(timeZone).heading.format(ms) : "";
}

/**
 * The first days (in the reader's zone) with an open time, each with every
 * open time and the unavailable ones between them. Times the reader booked or
 * was told were taken (`taken`) count as unavailable before the next read
 * confirms it.
 */
export function groupSlotDays(
  times: ChannelDemoTimes,
  timeZone: string,
  now: number,
  taken: ReadonlySet<number>,
): SlotDay[] {
  const f = formats(timeZone);
  const soonest = now + SLOT_LEAD_MS;
  const open = times.slots
    .map((slot) => ({
      startTime: slot.startTime,
      ms: Date.parse(slot.startTime),
    }))
    .filter(
      (slot) =>
        Number.isFinite(slot.ms) && slot.ms > soonest && !taken.has(slot.ms),
    )
    .sort((a, b) => a.ms - b.ms);

  const byDay = new Map<
    string,
    { at: number; open: typeof open; closed: number[] }
  >();
  for (const slot of open) {
    const key = f.key.format(slot.ms);
    const day = byDay.get(key);
    if (day) day.open.push(slot);
    else if (byDay.size < DAYS)
      byDay.set(key, { at: slot.ms, open: [slot], closed: [] });
    else break;
  }

  const openMs = new Set(open.map((slot) => slot.ms));
  const closedMs = new Set([
    ...times.unavailable.map((time) => Date.parse(time.startTime)),
    ...taken,
  ]);
  for (const ms of closedMs) {
    if (!Number.isFinite(ms) || ms <= soonest || openMs.has(ms)) continue;
    byDay.get(f.key.format(ms))?.closed.push(ms);
  }

  return [...byDay].map(([key, day]) => {
    const label = f.longDay.format(day.at);
    const first = day.open[0].ms;
    const last = day.open[day.open.length - 1].ms;
    // Only those among the open ones: a day never starts or ends on one.
    const closed = day.closed.filter((ms) => ms >= first && ms <= last);
    // When the clocks go back, an hour's clock times happen twice in a day:
    // each of those carries its zone ("11:00 PM GMT+3", "11:00 PM GMT+2").
    const clocks = [...day.open.map((slot) => slot.ms), ...closed].map((ms) =>
      f.time.format(ms),
    );
    const repeated = new Set(
      clocks.filter((clock, index) => clocks.indexOf(clock) !== index),
    );
    const timeOf = (ms: number) => {
      const time = f.time.format(ms);
      return repeated.has(time) ? f.zonedTime.format(ms) : time;
    };
    const chips: TimeChip[] = [
      ...day.open.map((slot): TimeChip => {
        const time = timeOf(slot.ms);
        return {
          available: true,
          startTime: slot.startTime,
          startMs: slot.ms,
          time,
          label: `${time}, ${label}`,
          heading: f.heading.format(slot.ms),
        };
      }),
      ...closed.map((ms): TimeChip => {
        const time = timeOf(ms);
        return {
          available: false,
          startMs: ms,
          time,
          label: `${time}, ${label}, unavailable`,
        };
      }),
    ].sort((a, b) => a.startMs - b.startMs);
    return {
      key,
      weekday: f.weekday.format(day.at),
      date: f.date.format(day.at),
      label,
      times: chips,
    };
  });
}

/** A time on a page, with its place among the day's open times (-1 if closed). */
export interface PagedTime {
  chip: TimeChip;
  slotIndex: number;
}

/**
 * A day's times in pages of `size`: every open time, and the unavailable ones
 * in their places but at most three in eight, so no page is mostly crossed
 * out. Every page holds an open time.
 */
export function pageTimes(
  chips: readonly TimeChip[],
  size: number,
): PagedTime[][] {
  const cap = Math.floor((size * 3) / 8);
  const pages: PagedTime[][] = [];
  let page: PagedTime[] = [];
  let closed = 0;
  let open = 0;
  for (const chip of chips) {
    if (page.length === size) {
      pages.push(page);
      page = [];
      closed = 0;
    }
    if (chip.available) page.push({ chip, slotIndex: open++ });
    else if (closed < cap) {
      page.push({ chip, slotIndex: -1 });
      closed++;
    }
  }
  if (page.length) pages.push(page);
  return pages.filter((entries) =>
    entries.some((entry) => entry.chip.available),
  );
}
