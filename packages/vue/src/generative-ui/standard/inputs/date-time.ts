// The framework-free date and time helpers of DateTimeInput.

/** What a DateTimeInput lets the user pick: a date, a time, or both. */
export type DateTimeMode = "date" | "time" | "datetime";

/** The two parts of a DateTimeInput value. */
export interface DateTimeParts {
  /** "YYYY-MM-DD", or "" */
  date: string;
  /** "HH:MM" (seconds kept when given), or "" */
  time: string;
}

/**
 * What the user picks: a date by default, a time with `enableTime`, or
 * both when `enableDate` is also true.
 *
 * @param props - The `enableDate` and `enableTime` props.
 */
export function dateTimeMode(props: {
  enableDate?: boolean;
  enableTime?: boolean;
}): DateTimeMode {
  const hasTime = props.enableTime === true;
  const hasDate = props.enableDate ?? !hasTime;
  return hasDate && hasTime ? "datetime" : hasTime ? "time" : "date";
}

/**
 * The date and the time of an ISO 8601 value: a date, a time, or both.
 *
 * @example splitDateTime("2026-10-23T14:30") // { date: "2026-10-23", time: "14:30" }
 */
export function splitDateTime(value: string): DateTimeParts {
  const [head = "", tail] = value.split("T");
  if (tail !== undefined) return { date: head, time: tail };
  if (/^\d{4}-/.test(value)) return { date: value, time: "" };
  if (/^\d{1,2}:\d{2}/.test(value)) return { date: "", time: value };
  return { date: "", time: "" };
}

/** The value of the parts, or "" while a part the mode needs is missing. */
export function joinDateTime(parts: DateTimeParts, mode: DateTimeMode) {
  if (mode === "date") return parts.date;
  if (mode === "time") return parts.time;
  return parts.date && parts.time ? `${parts.date}T${parts.time}` : "";
}

/**
 * The value in words, in the user's locale: "Thu, Oct 23, 2026, 2:30 PM".
 * Undefined for an incomplete or unparsable value.
 *
 * @param parts - The date and the time.
 * @param mode - Which parts the words say.
 * @param locale - The locale of the words. Default: the user's locale.
 */
export function describeDateTime(
  parts: DateTimeParts,
  mode: DateTimeMode,
  locale?: string,
) {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(parts.date);
  const time = /^(\d{1,2}):(\d{2})/.exec(parts.time);
  if ((mode !== "time" && !date) || (mode !== "date" && !time)) return;
  const year = Number(date?.[1] ?? 2000);
  const month = Number(date?.[2] ?? 1) - 1;
  const day = Number(date?.[3] ?? 1);
  const hours = Number(time?.[1] ?? 0);
  const minutes = Number(time?.[2] ?? 0);
  // The value has no time zone: it is formatted as written, in UTC, so a
  // daylight-saving gap of the viewer cannot shift it.
  const at = new Date(Date.UTC(year, month, day, hours, minutes));
  // Date.UTC rolls an impossible value over (February 30 to March 2); such
  // a value gets no summary rather than a different one.
  const isExact =
    at.getUTCFullYear() === year &&
    at.getUTCMonth() === month &&
    at.getUTCDate() === day &&
    at.getUTCHours() === hours &&
    at.getUTCMinutes() === minutes;
  if (Number.isNaN(at.getTime()) || !isExact) return;
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    ...(mode === "time"
      ? {}
      : { weekday: "short", year: "numeric", month: "short", day: "numeric" }),
    ...(mode === "date" ? {} : { hour: "numeric", minute: "2-digit" }),
  }).format(at);
}

/** "HH:MM" of a minute of the day. */
function minuteToTime(minute: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

/** "HH:MM:SS" of a time, seconds "00" when left out, so times compare as text. */
function fullTime(time: string) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(time);
  if (!match) return time;
  const [, hours = "", minutes = "", seconds = "00"] = match;
  return `${hours.padStart(2, "0")}:${minutes}:${seconds}`;
}

/** The minute of the day of a time, rounded up to a whole minute. */
function timeToMinute(time: string) {
  const [hours = 0, minutes = 0, seconds = 0] = fullTime(time)
    .split(":")
    .map(Number);
  return hours * 60 + minutes + (seconds > 0 ? 1 : 0);
}

/**
 * True when `time` lies within `min`..`max`, seconds included. A `min`
 * after `max` is a range over midnight, such as 22:00 to 02:00.
 *
 * @example timeInRange("23:00", "22:00", "02:00") // true
 */
export function timeInRange(time: string, min?: string, max?: string) {
  const at = fullTime(time);
  const from = min ? fullTime(min) : undefined;
  const to = max ? fullTime(max) : undefined;
  if (from && to && from > to) return at >= from || at <= to;
  return (!from || at >= from) && (!to || at <= to);
}

/**
 * The times `step` minutes apart from `min` (or midnight) up to `max` (or
 * the end of the day), "HH:MM". A range over midnight continues after
 * 23:59. `current` is added when it is set and not one of them, so the list
 * shows the value it holds even when that value is out of range.
 *
 * @example timeSlots(30, "09:00", "10:00") // ["09:00", "09:30", "10:00"]
 */
export function timeSlots(
  step: number,
  min?: string,
  max?: string,
  current?: string,
) {
  const day = 24 * 60;
  const start = min ? timeToMinute(min) : 0;
  let end = max
    ? timeToMinute(max) - (fullTime(max).endsWith(":00") ? 0 : 1)
    : day - 1;
  if (end < start) end += day;
  const slots: string[] = [];
  for (
    let minute = start;
    minute <= end && minute < start + day;
    minute += step
  ) {
    slots.push(minuteToTime(minute % day));
  }
  const shown = current?.slice(0, 5);
  if (shown && !slots.includes(shown)) {
    // In order from the start of the range.
    const offset = (time: string) => (timeToMinute(time) - start + day) % day;
    const index = slots.findIndex((slot) => offset(slot) > offset(shown));
    slots.splice(index === -1 ? slots.length : index, 0, shown);
  }
  return slots;
}
