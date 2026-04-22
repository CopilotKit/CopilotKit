import { describe, it, expect } from "vitest";
import {
  normalizeAutoScroll,
  type AutoScrollMode,
} from "../normalize-auto-scroll";

describe("normalizeAutoScroll", () => {
  it("returns 'pin-to-bottom' for undefined (default)", () => {
    expect(normalizeAutoScroll(undefined)).toBe("pin-to-bottom");
  });

  it("maps true -> 'pin-to-bottom'", () => {
    expect(normalizeAutoScroll(true)).toBe("pin-to-bottom");
  });

  it("maps false -> 'none'", () => {
    expect(normalizeAutoScroll(false)).toBe("none");
  });

  it("passes 'pin-to-bottom' through", () => {
    expect(normalizeAutoScroll("pin-to-bottom")).toBe("pin-to-bottom");
  });

  it("passes 'pin-to-send' through", () => {
    expect(normalizeAutoScroll("pin-to-send")).toBe("pin-to-send");
  });

  it("passes 'none' through", () => {
    expect(normalizeAutoScroll("none")).toBe("none");
  });

  it("falls back to 'pin-to-bottom' for unknown strings", () => {
    expect(normalizeAutoScroll("bogus" as AutoScrollMode)).toBe(
      "pin-to-bottom",
    );
  });
});
