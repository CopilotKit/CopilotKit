import { expect, test } from "vitest";
import { parseIncidentDate } from "./incident-date";

test("parses an ISO calendar date", () => {
  const result = parseIncidentDate("2026-08-31");

  expect(result?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
});

test("rejects a relative date", () => {
  const result = parseIncidentDate("today");

  expect(result).toBeNull();
});

test("rejects an impossible calendar date", () => {
  const result = parseIncidentDate("2026-02-30");

  expect(result).toBeNull();
});
