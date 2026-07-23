import { describe, it, expect } from "vitest";
import { formatTimestamp } from "../utils";

describe("formatTimestamp", () => {
  it("formats AM times correctly", () => {
    const date = new Date(2025, 0, 15, 9, 5); // 9:05 AM
    expect(formatTimestamp(date)).toBe("9:05 AM");
  });

  it("formats PM times correctly", () => {
    const date = new Date(2025, 0, 15, 14, 30); // 2:30 PM
    expect(formatTimestamp(date)).toBe("2:30 PM");
  });

  it("formats 12:00 PM (noon) correctly", () => {
    const date = new Date(2025, 0, 15, 12, 0);
    expect(formatTimestamp(date)).toBe("12:00 PM");
  });

  it("formats 12:00 AM (midnight) correctly", () => {
    const date = new Date(2025, 0, 15, 0, 0);
    expect(formatTimestamp(date)).toBe("12:00 AM");
  });

  it("pads single-digit minutes with leading zero", () => {
    const date = new Date(2025, 0, 15, 8, 3);
    expect(formatTimestamp(date)).toBe("8:03 AM");
  });

  it("formats 11:59 PM correctly", () => {
    const date = new Date(2025, 0, 15, 23, 59);
    expect(formatTimestamp(date)).toBe("11:59 PM");
  });

  it("formats 1:00 AM correctly", () => {
    const date = new Date(2025, 0, 15, 1, 0);
    expect(formatTimestamp(date)).toBe("1:00 AM");
  });
});
