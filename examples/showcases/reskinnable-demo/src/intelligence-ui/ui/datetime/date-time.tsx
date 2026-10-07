import type { ReactNode } from 'react';

export type DateTimeInput = Date | number | string | null | undefined;

export type DateTimeGranularity = 'minute' | 'hour' | 'day' | 'week' | 'month';

export type DateTimeZone = 'local' | 'UTC' | string;

export interface DateFormatOptions {
  readonly locale?: string;
  readonly timeZone?: DateTimeZone;
  readonly invalidFallback?: string;
}

export interface TimeBucketFormatOptions extends DateFormatOptions {
  readonly granularity: DateTimeGranularity;
}

export interface FormattedDateTimeProps extends DateFormatOptions {
  readonly value: DateTimeInput;
  readonly variant?: 'date' | 'dateTime' | 'timeBucket';
  readonly granularity?: DateTimeGranularity;
}

const DEFAULT_INVALID_FALLBACK = '-';

const ISO_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ISO_OFFSET_PATTERN = /(Z|[+-]\d{2}:\d{2})$/u;

/** Returns the Intl timezone option for a UI timezone selector. */
function resolveTimeZone(
  timeZone: DateTimeZone | undefined,
): string | undefined {
  return timeZone === 'local' ? undefined : timeZone;
}

/** Checks whether a Date instance carries a finite timestamp. */
function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

/** Parses date-like UI input while avoiding local-time guesses for ISO strings. */
function parseDateValue(
  value: DateTimeInput,
  allowDateOnly: boolean,
): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return isValidDate(value) ? value : null;
  }

  if (typeof value === 'number') {
    const parsed = new Date(value);
    return isValidDate(parsed) ? parsed : null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (allowDateOnly && ISO_DATE_ONLY_PATTERN.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00.000Z`);
    return isValidDate(parsed) ? parsed : null;
  }

  if (!ISO_OFFSET_PATTERN.test(trimmed)) {
    return null;
  }

  const parsed = new Date(trimmed);
  return isValidDate(parsed) ? parsed : null;
}

/** Parses an offset-aware ISO instant into a Date for UI boundary validation. */
export function parseIsoInstant(value: DateTimeInput): Date | null {
  return parseDateValue(value, false);
}

/** Formats a date-only label with deterministic fallback behavior. */
export function formatDate(
  value: DateTimeInput,
  options: DateFormatOptions = {},
): string {
  const parsed = parseDateValue(value, true);
  if (parsed === null) {
    return options.invalidFallback ?? DEFAULT_INVALID_FALLBACK;
  }

  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: 'medium',
    timeZone: resolveTimeZone(options.timeZone),
  }).format(parsed);
}

/** Formats an instant with date and time using Intl.DateTimeFormat. */
export function formatDateTime(
  value: DateTimeInput,
  options: DateFormatOptions = {},
): string {
  const parsed = parseDateValue(value, false);
  if (parsed === null) {
    return options.invalidFallback ?? DEFAULT_INVALID_FALLBACK;
  }

  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: resolveTimeZone(options.timeZone),
  }).format(parsed);
}

/** Formats a temporal bucket using explicit granularity and timezone metadata. */
export function formatTimeBucket(
  value: DateTimeInput,
  options: TimeBucketFormatOptions,
): string {
  const parsed = parseDateValue(value, true);
  if (parsed === null) {
    return options.invalidFallback ?? DEFAULT_INVALID_FALLBACK;
  }

  const timeZone = resolveTimeZone(options.timeZone ?? 'UTC');

  if (options.granularity === 'minute') {
    return new Intl.DateTimeFormat(options.locale, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(parsed);
  }

  if (options.granularity === 'hour') {
    return new Intl.DateTimeFormat(options.locale, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      timeZone,
      timeZoneName: 'short',
    }).format(parsed);
  }

  if (options.granularity === 'week') {
    return `Week of ${new Intl.DateTimeFormat(options.locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone,
    }).format(parsed)}`;
  }

  if (options.granularity === 'month') {
    return new Intl.DateTimeFormat(options.locale, {
      month: 'short',
      year: 'numeric',
      timeZone,
    }).format(parsed);
  }

  return new Intl.DateTimeFormat(options.locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(parsed);
}

/** Renders a formatted date, date-time, or temporal bucket with invalid fallback text. */
export function FormattedDateTime({
  value,
  variant = 'dateTime',
  granularity = 'day',
  locale,
  timeZone,
  invalidFallback,
}: FormattedDateTimeProps): ReactNode {
  if (variant === 'date') {
    return formatDate(value, { locale, timeZone, invalidFallback });
  }

  if (variant === 'timeBucket') {
    return formatTimeBucket(value, {
      granularity,
      locale,
      timeZone,
      invalidFallback,
    });
  }

  return formatDateTime(value, { locale, timeZone, invalidFallback });
}
