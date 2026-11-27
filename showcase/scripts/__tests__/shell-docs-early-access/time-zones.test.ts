// The channel demo booker's time zones (shell-docs
// src/lib/early-access/time-zones.ts).
import { describe, expect, test } from "vitest";

import {
  canonicalTimeZone,
  isValidTimeZone,
  timeZoneOptions,
  zoneLabel,
} from "../../../shell-docs/src/lib/early-access/time-zones";

describe("time zones", () => {
  test("a legacy and a modern name for one zone are the same zone", () => {
    // V8 reports India as Asia/Calcutta; the picker's list says Asia/Kolkata.
    expect(canonicalTimeZone("Asia/Kolkata")).toBe(
      canonicalTimeZone("Asia/Calcutta"),
    );
    const options = timeZoneOptions("Asia/Calcutta");
    expect(options.filter((o) => o.label.startsWith("India"))).toHaveLength(1);
    expect(options.some((o) => o.label.startsWith("Calcutta"))).toBe(false);
    expect(
      options.filter((o) => o.zone === canonicalTimeZone("Asia/Calcutta")),
    ).toHaveLength(1);
  });

  test("the list names each zone by its canonical id", () => {
    for (const { zone } of timeZoneOptions("UTC")) {
      expect(canonicalTimeZone(zone)).toBe(zone);
    }
  });

  test("a zone the list doesn't have leads the list, named by its city", () => {
    const options = timeZoneOptions("America/Argentina/Buenos_Aires");
    expect(options[0].label.startsWith("Buenos Aires")).toBe(true);
  });

  test("labels name the zone as it is at the given time", () => {
    const january = Date.parse("2027-01-15T12:00:00Z");
    const july = Date.parse("2027-07-15T12:00:00Z");
    expect(zoneLabel("America/New_York", january)).toBe("Eastern (EST)");
    expect(zoneLabel("America/New_York", july)).toBe("Eastern (EDT)");
    expect(zoneLabel("UTC", july)).toBe("UTC");
  });

  test("only zones Intl knows are valid", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("x".repeat(65))).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});
