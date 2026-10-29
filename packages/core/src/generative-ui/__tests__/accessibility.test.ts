import { describe, expect, it } from "vitest";
import { accessibilityAttributes, readAccessibility } from "../accessibility";

describe("readAccessibility", () => {
  it("keeps the well-typed fields and drops the rest", () => {
    expect(
      readAccessibility({
        label: "Totals",
        description: 7,
        live: "loud",
        hidden: "yes",
      }),
    ).toEqual({ label: "Totals" });
    expect(readAccessibility({ label: { "@path": "/x" } })).toBeUndefined();
    expect(readAccessibility("x")).toBeUndefined();
    expect(readAccessibility({ hidden: false, live: "off" })).toEqual({
      hidden: false,
      live: "off",
    });
  });
});

describe("accessibilityAttributes", () => {
  it("maps to ARIA, writing an explicit off and only a true hidden", () => {
    expect(
      accessibilityAttributes({
        label: "Totals",
        description: "The order",
        live: "off",
        hidden: false,
      }),
    ).toEqual({
      "aria-label": "Totals",
      "aria-description": "The order",
      "aria-live": "off",
    });
    expect(accessibilityAttributes({ live: "polite", hidden: true })).toEqual({
      "aria-live": "polite",
      "aria-hidden": true,
    });
    expect(accessibilityAttributes(undefined)).toEqual({});
  });
});
