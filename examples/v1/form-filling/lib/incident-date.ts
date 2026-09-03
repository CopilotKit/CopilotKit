import { z } from "zod";

const isoCalendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const earliestIncidentDate = new Date(1900, 0, 1);

/**
 * Checks whether an incident date is selectable by the form.
 *
 * @param date - The incident date to validate.
 * @param today - The inclusive upper boundary, injectable for deterministic tests.
 * @returns Whether the date is between January 1, 1900 and today, inclusive.
 */
export function isIncidentDateAllowed(
  date: Date,
  today: Date = new Date(),
): boolean {
  return date >= earliestIncidentDate && date <= today;
}

/**
 * Parses a calendar date without accepting relative or impossible dates.
 *
 * @param value - A date in YYYY-MM-DD format.
 * @returns The parsed date, or null when the value is invalid.
 */
export function parseIncidentDate(value: string): Date | null {
  if (!isoCalendarDatePattern.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  const isSameCalendarDate =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;

  return isSameCalendarDate ? date : null;
}

/**
 * Serializes an incident date for agent context.
 *
 * @param date - The incident date selected in the form.
 * @returns The serialized incident date.
 */
export function serializeIncidentDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export const incidentDateSchema = z
  .string()
  .regex(isoCalendarDatePattern, "Use YYYY-MM-DD format")
  .refine(
    (value) => {
      const date = parseIncidentDate(value);

      return date !== null && isIncidentDateAllowed(date);
    },
    {
      message: "Use a valid date from January 1, 1900 through today",
    },
  );
