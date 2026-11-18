import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { classNames } from "../class-names";
import { Button } from "../primitives/actions";
import styles from "./calendar.module.css";

/**
 * An inclusive range of local calendar days. `to` is absent while the reader
 * has chosen a start day but not yet an end day. Only the local year, month,
 * and day of each `Date` are meaningful; the time of day is ignored.
 */
export interface CalendarDateRange {
  readonly from: Date;
  readonly to?: Date;
}

/** Days outside these inclusive bounds cannot be focused or selected. */
export interface CalendarDisabledDays {
  /** Days before this local day are disabled. */
  readonly before?: Date;
  /** Days after this local day are disabled. */
  readonly after?: Date;
}

/** Props for {@link Calendar}. */
export interface CalendarProps {
  /** Accessible name for the whole calendar group. */
  readonly "aria-label"?: string;
  readonly className?: string;
  /** First visible month when the calendar mounts. Defaults to `today`. */
  readonly defaultMonth?: Date;
  /** Days that cannot be focused or selected. */
  readonly disabled?: CalendarDisabledDays;
  /** Last month the reader can navigate to (the last visible month). */
  readonly endMonth?: Date;
  /** BCP 47 locale for month, weekday, and day names. */
  readonly locale?: string;
  /** Visible months, side by side. */
  readonly numberOfMonths?: number;
  /** Called with the next range whenever the reader picks a day. */
  readonly onSelect?: (range: CalendarDateRange) => void;
  /** The current range; the calendar never keeps its own selection. */
  readonly selected?: CalendarDateRange;
  /** Render days from neighbouring months in the leading and trailing weeks. */
  readonly showOutsideDays?: boolean;
  /** First month the reader can navigate to. */
  readonly startMonth?: Date;
  /** The day to mark as today. Defaults to the current local day. */
  readonly today?: Date;
  /** First column of each week: 0 is Sunday, 1 is Monday. */
  readonly weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

const DAYS_PER_WEEK = 7;
/** Upper bound on day-by-day searches for an enabled day. */
const MAX_DAY_SEARCH = 400;

/**
 * Return the local midnight of a date.
 *
 * @param date - Any instant.
 * @returns A new `Date` at 00:00 local time on the same calendar day.
 */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Add whole calendar days, staying at local midnight across DST changes.
 *
 * @param date - The starting day.
 * @param days - Days to add; negative values move backwards.
 * @returns The shifted local day.
 */
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * Return the number of days in a date's month.
 *
 * @param date - Any day in the month.
 * @returns 28 to 31.
 */
function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * Add whole months, clamping the day to the target month's length
 * (January 31 plus one month is February 28 or 29).
 *
 * @param date - The starting day.
 * @param months - Months to add; negative values move backwards.
 * @returns The shifted local day.
 */
function addMonths(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  return new Date(
    target.getFullYear(),
    target.getMonth(),
    Math.min(date.getDate(), daysInMonth(target)),
  );
}

/**
 * Return the first day of a date's month.
 *
 * @param date - Any day in the month.
 * @returns The first local day of that month.
 */
function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Give each month a sortable integer so months compare without time zones.
 *
 * @param date - Any day in the month.
 * @returns `year * 12 + month`.
 */
function monthNumber(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

/**
 * Give each day a sortable integer so days compare without time zones or DST.
 *
 * @param date - Any instant on the day.
 * @returns `YYYYMMDD` as a number.
 */
function dayNumber(date: Date): number {
  return (
    date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate()
  );
}

/**
 * Format a local day as `YYYY-MM-DD` for DOM lookups and React keys.
 *
 * @param date - Any instant on the day.
 * @returns The local calendar date string.
 */
function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${month}-${day}`;
}

/**
 * Return the first day of the week containing `date`.
 *
 * @param date - Any day.
 * @param weekStartsOn - Weekday index of the first column.
 * @returns The local day that starts the week.
 */
function startOfWeek(date: Date, weekStartsOn: number): Date {
  const offset = (date.getDay() - weekStartsOn + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return addDays(date, -offset);
}

/**
 * Compute the next range after the reader picks `day`.
 *
 * A pick starts a new range unless exactly one start day is chosen; then it
 * completes the range, ordering the two days so `from` is never after `to`.
 * Picking the start day again makes a one-day range.
 *
 * @param current - The range before the pick.
 * @param day - The picked day.
 * @returns The next range, with both bounds at local midnight.
 */
export function selectCalendarRange(
  current: CalendarDateRange | undefined,
  day: Date,
): CalendarDateRange {
  const picked = startOfDay(day);
  if (current === undefined || current.to !== undefined) {
    return { from: picked };
  }

  const from = startOfDay(current.from);
  return dayNumber(picked) < dayNumber(from)
    ? { from: picked, to: from }
    : { from, to: picked };
}

/**
 * Check a day against the disabled bounds.
 *
 * @param day - The day to check.
 * @param disabled - The disabled bounds, if any.
 * @returns Whether the day cannot be chosen.
 */
function isDayDisabled(
  day: Date,
  disabled: CalendarDisabledDays | undefined,
): boolean {
  if (disabled === undefined) return false;
  const value = dayNumber(day);
  if (disabled.before !== undefined && value < dayNumber(disabled.before)) {
    return true;
  }
  return disabled.after !== undefined && value > dayNumber(disabled.after);
}

/**
 * Build the weeks shown for one month grid.
 *
 * @param month - The first day of the month.
 * @param weekStartsOn - Weekday index of the first column.
 * @returns Weeks of seven local days, covering every day in the month.
 */
function monthWeeks(month: Date, weekStartsOn: number): readonly Date[][] {
  const first = startOfWeek(month, weekStartsOn);
  const last = new Date(
    month.getFullYear(),
    month.getMonth(),
    daysInMonth(month),
  );
  const weeks: Date[][] = [];
  for (let cursor = first; dayNumber(cursor) <= dayNumber(last); ) {
    const week = Array.from({ length: DAYS_PER_WEEK }, (_, index) =>
      addDays(cursor, index),
    );
    weeks.push(week);
    cursor = addDays(cursor, DAYS_PER_WEEK);
  }
  return weeks;
}

/** Where a day sits relative to the selected range. */
interface DaySelection {
  readonly selected: boolean;
  readonly start: boolean;
  readonly end: boolean;
  readonly middle: boolean;
}

/**
 * Describe how a day relates to the selected range.
 *
 * @param day - The day to describe.
 * @param range - The selected range, if any.
 * @returns Selection flags for styling and `aria-selected`.
 */
function daySelection(
  day: Date,
  range: CalendarDateRange | undefined,
): DaySelection {
  if (range === undefined) {
    return { selected: false, start: false, end: false, middle: false };
  }
  const value = dayNumber(day);
  const from = dayNumber(range.from);
  const to = range.to === undefined ? from : dayNumber(range.to);
  const start = value === from;
  const end = value === to;
  const selected = value >= from && value <= to;
  return { selected, start, end, middle: selected && !start && !end };
}

/**
 * Accessible range calendar in the shadcn composition: one or more month
 * grids with previous/next month controls, a today marker, disabled days, and
 * range selection.
 *
 * Each month is a `role="grid"` table named by its caption. Day buttons use a
 * roving tab stop, so Tab enters and leaves the calendar in one step. Arrow
 * keys move by day or week, Home/End jump to the week's edges, PageUp and
 * PageDown move by month (with Shift, by year), and Enter or Space picks the
 * focused day. Focus skips disabled days; the visible months follow focus.
 * The component is controlled: pass `selected` and update it from `onSelect`.
 *
 * @param props - See {@link CalendarProps}.
 * @returns The calendar.
 */
export function Calendar(props: CalendarProps): React.JSX.Element {
  const numberOfMonths = Math.max(1, Math.floor(props.numberOfMonths ?? 1));
  const weekStartsOn = props.weekStartsOn ?? 0;
  const locale = props.locale ?? "en-US";
  const showOutsideDays = props.showOutsideDays ?? true;
  const today = useMemo(
    () => startOfDay(props.today ?? new Date()),
    [props.today],
  );
  const minMonth =
    props.startMonth === undefined ? undefined : monthNumber(props.startMonth);
  const maxFirstMonth =
    props.endMonth === undefined
      ? undefined
      : monthNumber(props.endMonth) - (numberOfMonths - 1);

  /**
   * Clamp a desired first visible month to the navigation bounds.
   *
   * @param month - Any day in the desired first month.
   * @returns The first day of the allowed first month.
   */
  function clampFirstMonth(month: Date): Date {
    let value = monthNumber(month);
    if (maxFirstMonth !== undefined && value > maxFirstMonth)
      value = maxFirstMonth;
    if (minMonth !== undefined && value < minMonth) value = minMonth;
    return new Date(Math.floor(value / 12), value % 12, 1);
  }

  const [firstMonth, setFirstMonth] = useState<Date>(() =>
    clampFirstMonth(props.defaultMonth ?? today),
  );
  const [focusedDay, setFocusedDay] = useState<Date | undefined>(undefined);
  const shouldFocusRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  const months = Array.from({ length: numberOfMonths }, (_, index) =>
    startOfMonth(addMonths(firstMonth, index)),
  );
  const firstVisible = monthNumber(months[0]);
  const lastVisible = monthNumber(months[months.length - 1]);

  const formatters = useMemo(
    () => ({
      caption: new Intl.DateTimeFormat(locale, {
        month: "long",
        year: "numeric",
      }),
      day: new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "long",
        weekday: "long",
        year: "numeric",
      }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: "short" }),
      weekdayLong: new Intl.DateTimeFormat(locale, { weekday: "long" }),
    }),
    [locale],
  );
  const weekdays = useMemo(() => {
    // 2026-01-04 is a Sunday; walk forward from the configured first weekday.
    const sunday = new Date(2026, 0, 4);
    return Array.from({ length: DAYS_PER_WEEK }, (_, index) => {
      const day = addDays(sunday, weekStartsOn + index);
      return {
        key: day.getDay(),
        long: formatters.weekdayLong.format(day),
        short: formatters.weekday.format(day).slice(0, 2),
      };
    });
  }, [formatters, weekStartsOn]);

  /**
   * Whether a day can take focus: enabled and inside the navigation bounds.
   *
   * @param day - The candidate day.
   * @returns `true` when focus may land on it.
   */
  function isFocusable(day: Date): boolean {
    const month = monthNumber(day);
    if (minMonth !== undefined && month < minMonth) return false;
    if (props.endMonth !== undefined && month > monthNumber(props.endMonth)) {
      return false;
    }
    return !isDayDisabled(day, props.disabled);
  }

  /**
   * Whether a day belongs to one of the visible months.
   *
   * @param day - The candidate day.
   * @returns `true` when its own month grid is rendered.
   */
  function isVisible(day: Date): boolean {
    const month = monthNumber(day);
    return month >= firstVisible && month <= lastVisible;
  }

  const tabStop = resolveTabStop();

  /**
   * Pick the single day button that takes the calendar's tab stop: the last
   * focused day, then the selected range, then today, then the first enabled
   * day in view.
   *
   * @returns The `YYYY-MM-DD` key of the tab stop, or `undefined` if none.
   */
  function resolveTabStop(): string | undefined {
    const candidates = [
      focusedDay,
      props.selected?.from,
      props.selected?.to,
      today,
    ];
    const visibleCandidate = candidates.find(
      (day): day is Date =>
        day !== undefined && isVisible(day) && isFocusable(day),
    );
    if (visibleCandidate !== undefined) return dayKey(visibleCandidate);
    for (const month of months) {
      for (let day = 1; day <= daysInMonth(month); day += 1) {
        const candidate = new Date(month.getFullYear(), month.getMonth(), day);
        if (isFocusable(candidate)) return dayKey(candidate);
      }
    }
    return undefined;
  }

  useEffect(() => {
    if (!shouldFocusRef.current || focusedDay === undefined) return;
    shouldFocusRef.current = false;
    rootRef.current
      ?.querySelector<HTMLButtonElement>(
        `button[data-day="${dayKey(focusedDay)}"]`,
      )
      ?.focus();
  }, [focusedDay, firstMonth]);

  /**
   * Move keyboard focus to a day, scrolling the visible months to it.
   *
   * @param day - The day to focus; must be focusable.
   */
  function moveFocus(day: Date): void {
    const month = monthNumber(day);
    if (month < firstVisible) setFirstMonth(clampFirstMonth(day));
    else if (month > lastVisible) {
      setFirstMonth(
        clampFirstMonth(addMonths(startOfMonth(day), -(numberOfMonths - 1))),
      );
    }
    shouldFocusRef.current = true;
    setFocusedDay(day);
  }

  /**
   * Walk from `start` in steps of `step` days until a focusable day appears.
   *
   * @param start - The first candidate.
   * @param step - Days between candidates (sign sets the direction).
   * @returns The first focusable day, or `undefined` when none is in reach.
   */
  function findFocusable(start: Date, step: number): Date | undefined {
    let candidate = start;
    for (let attempt = 0; attempt < MAX_DAY_SEARCH; attempt += 1) {
      if (isFocusable(candidate)) return candidate;
      candidate = addDays(candidate, step);
    }
    return undefined;
  }

  /**
   * Resolve the target of a navigation key, or `undefined` for other keys.
   *
   * @param event - The keydown event from a day button.
   * @param day - The day that currently has focus.
   * @returns The day focus should move to and the search direction.
   */
  function keyTarget(
    event: KeyboardEvent<HTMLButtonElement>,
    day: Date,
  ): { readonly target: Date; readonly step: number } | undefined {
    switch (event.key) {
      case "ArrowLeft":
        return { target: addDays(day, -1), step: -1 };
      case "ArrowRight":
        return { target: addDays(day, 1), step: 1 };
      case "ArrowUp":
        return { target: addDays(day, -DAYS_PER_WEEK), step: -DAYS_PER_WEEK };
      case "ArrowDown":
        return { target: addDays(day, DAYS_PER_WEEK), step: DAYS_PER_WEEK };
      case "Home":
        return { target: startOfWeek(day, weekStartsOn), step: 1 };
      case "End":
        return {
          target: addDays(startOfWeek(day, weekStartsOn), DAYS_PER_WEEK - 1),
          step: -1,
        };
      case "PageUp":
        // A month or year back; if that day is disabled, walk toward `day`.
        return { target: addMonths(day, event.shiftKey ? -12 : -1), step: 1 };
      case "PageDown":
        return { target: addMonths(day, event.shiftKey ? 12 : 1), step: -1 };
      default:
        return undefined;
    }
  }

  /**
   * Handle grid keyboard navigation and selection for one day button.
   *
   * @param event - The keydown event.
   * @param day - The day the button represents.
   */
  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    day: Date,
  ): void {
    if (event.key === "Enter" || event.key === " ") {
      // Handle activation here, not through the native click, so Space and
      // Enter behave the same in every browser and never pick twice.
      event.preventDefault();
      if (isFocusable(day))
        props.onSelect?.(selectCalendarRange(props.selected, day));
      return;
    }
    const move = keyTarget(event, day);
    if (move === undefined) return;
    event.preventDefault();
    const isPage = event.key === "PageUp" || event.key === "PageDown";
    const next = findFocusable(move.target, move.step);
    if (next === undefined) return;
    // A page move that walked back past the starting day found nothing new.
    if (isPage && dayNumber(next) === dayNumber(day)) return;
    moveFocus(next);
  }

  const canGoBack = minMonth === undefined || firstVisible > minMonth;
  const canGoForward =
    maxFirstMonth === undefined || firstVisible < maxFirstMonth;

  return (
    <div
      aria-label={props["aria-label"]}
      className={classNames(styles.calendar, props.className)}
      data-slot="calendar"
      ref={rootRef}
      role={props["aria-label"] === undefined ? undefined : "group"}
    >
      <div className={styles.nav}>
        <Button
          aria-label="Previous month"
          disabled={!canGoBack}
          onClick={() =>
            setFirstMonth(clampFirstMonth(addMonths(firstMonth, -1)))
          }
          size="icon-sm"
          variant="ghost"
        >
          <ChevronLeft aria-hidden="true" size={16} />
        </Button>
        <Button
          aria-label="Next month"
          disabled={!canGoForward}
          onClick={() =>
            setFirstMonth(clampFirstMonth(addMonths(firstMonth, 1)))
          }
          size="icon-sm"
          variant="ghost"
        >
          <ChevronRight aria-hidden="true" size={16} />
        </Button>
      </div>
      <div className={styles.months}>
        {months.map((month) => {
          const captionId = `${baseId}-${dayKey(month)}`;
          return (
            <div className={styles.month} key={dayKey(month)}>
              <div aria-live="polite" className={styles.caption} id={captionId}>
                {formatters.caption.format(month)}
              </div>
              <table
                aria-labelledby={captionId}
                aria-multiselectable="true"
                className={styles.grid}
                role="grid"
              >
                <thead aria-hidden="true">
                  <tr>
                    {weekdays.map((weekday) => (
                      <th
                        className={styles.weekday}
                        key={weekday.key}
                        scope="col"
                        title={weekday.long}
                      >
                        {weekday.short}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthWeeks(month, weekStartsOn).map((week) => (
                    <tr key={dayKey(week[0])}>
                      {week.map((day) => {
                        const outside = monthNumber(day) !== monthNumber(month);
                        if (outside && !showOutsideDays) {
                          return (
                            <td
                              aria-hidden="true"
                              className={styles.day}
                              data-hidden="true"
                              key={dayKey(day)}
                            />
                          );
                        }
                        const selection = daySelection(day, props.selected);
                        const disabled = !isFocusable(day);
                        const isToday = dayNumber(day) === dayNumber(today);
                        const key = dayKey(day);
                        const label = formatters.day.format(day);
                        return (
                          <td
                            aria-selected={selection.selected}
                            className={styles.day}
                            data-disabled={disabled ? "true" : undefined}
                            data-outside={outside ? "true" : undefined}
                            data-range-end={selection.end ? "true" : undefined}
                            data-range-middle={
                              selection.middle ? "true" : undefined
                            }
                            data-range-start={
                              selection.start ? "true" : undefined
                            }
                            data-today={isToday ? "true" : undefined}
                            key={key}
                            role="gridcell"
                          >
                            <button
                              aria-current={isToday ? "date" : undefined}
                              aria-label={isToday ? `Today, ${label}` : label}
                              className={styles.dayButton}
                              data-day={outside ? undefined : key}
                              disabled={disabled}
                              onClick={() => {
                                if (outside) setFocusedDay(day);
                                props.onSelect?.(
                                  selectCalendarRange(props.selected, day),
                                );
                              }}
                              onFocus={() => setFocusedDay(day)}
                              onKeyDown={(event) => handleKeyDown(event, day)}
                              tabIndex={!outside && key === tabStop ? 0 : -1}
                              type="button"
                            >
                              {day.getDate()}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
