import { describe, expect, it } from "vitest";
import { formatValue, formatDelta, deltaTone } from "./format";

describe("formatValue", () => {
  it("renders USD compactly for exec reading", () => {
    expect(formatValue(12_400_000, "usd", { compact: true })).toBe("$12.4M");
    expect(formatValue(940_000, "usd", { compact: true })).toBe("$940K");
  });
  it("renders full USD with no cents", () => {
    expect(formatValue(12_450_678, "usd")).toBe("$12,450,678");
  });
  it("renders ratios, percentages and months with their units", () => {
    expect(formatValue(3.42, "ratio")).toBe("3.4x");
    expect(formatValue(0.1234, "pct")).toBe("12.3%");
    expect(formatValue(18.4, "months")).toBe("18.4 mo");
  });
});

describe("formatDelta", () => {
  it("always carries an explicit sign", () => {
    expect(formatDelta(0.0412)).toBe("+4.1%");
    expect(formatDelta(-0.0412)).toBe("-4.1%");
    expect(formatDelta(0)).toBe("0.0%");
  });
});

describe("deltaTone", () => {
  it("treats growth as good for revenue-shaped metrics", () => {
    expect(deltaTone(0.05, "usd")).toBe("positive");
    expect(deltaTone(-0.05, "usd")).toBe("negative");
  });

  it("INVERTS for metrics where down is good", () => {
    // A rising CAC payback or churn rate is bad news; a single "green when
    // positive" rule would paint worsening churn green on a projector.
    expect(deltaTone(0.05, "months")).toBe("negative");
    expect(deltaTone(-0.05, "months")).toBe("positive");
    expect(deltaTone(0.05, "pct")).toBe("negative");
  });

  it("is neutral for an immaterial move", () => {
    expect(deltaTone(0.0004, "usd")).toBe("neutral");
  });
});
