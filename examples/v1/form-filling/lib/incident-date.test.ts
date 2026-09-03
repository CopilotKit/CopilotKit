import { expect, test } from "vitest";
import {
  isIncidentDateAllowed,
  parseIncidentDate,
  serializeIncidentDate,
} from "./incident-date";

test("checks incident date boundaries against an explicit current date", () => {
  const today = new Date(2026, 8, 2, 12);

  expect(isIncidentDateAllowed(new Date(1899, 11, 31), today)).toBe(false);
  expect(isIncidentDateAllowed(new Date(1900, 0, 1), today)).toBe(true);
  expect(isIncidentDateAllowed(new Date(2026, 8, 2), today)).toBe(true);
  expect(isIncidentDateAllowed(new Date(2026, 8, 3), today)).toBe(false);
});

test("parses an ISO calendar date as a local calendar date", () => {
  const result = parseIncidentDate("2026-08-31");

  expect(result).not.toBeNull();
  expect(result?.getFullYear()).toBe(2026);
  expect(result?.getMonth()).toBe(7);
  expect(result?.getDate()).toBe(31);
});

test("rejects a relative date", () => {
  const result = parseIncidentDate("today");

  expect(result).toBeNull();
});

test("rejects an impossible calendar date", () => {
  const result = parseIncidentDate("2026-02-30");

  expect(result).toBeNull();
});

test("serializes a local calendar date without a timestamp", () => {
  const date = new Date(2026, 7, 31);

  const result = serializeIncidentDate(date);

  expect(result).toBe("2026-08-31");
});
