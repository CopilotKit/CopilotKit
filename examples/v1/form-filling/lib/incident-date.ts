import { z } from "zod";

const isoCalendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;

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

  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export const incidentDateSchema = z
  .string()
  .regex(isoCalendarDatePattern, "Use YYYY-MM-DD format")
  .refine((value) => parseIncidentDate(value) !== null, {
    message: "Use a valid calendar date",
  });
