import { afterEach, describe, expect, it, vi } from "vitest";
import { GENERATIVE_UI_FUNCTIONS } from "@copilotkit/shared";
import { BASIC_FUNCTIONS, ExpressionError, openUrlSafely } from "../functions";
// The resolver adds calc and series to the registry.
import "../resolve";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fn = (name: string, args: Record<string, unknown>): any =>
  BASIC_FUNCTIONS[name](args);

describe("basic functions", () => {
  it("implements every built-in function that the shared list names", () => {
    const names = Object.keys(GENERATIVE_UI_FUNCTIONS);
    expect(Object.keys(BASIC_FUNCTIONS).sort()).toEqual(names.sort());
  });

  it("validates with required, regex, length, numeric and email", () => {
    expect(fn("required", { value: "" })).toEqual({
      valid: false,
      message: "Required",
    });
    expect(fn("required", { value: [] }).valid).toBe(false);
    expect(fn("required", { value: 0 }).valid).toBe(true);
    expect(
      fn("regex", { value: "AB-12", pattern: "^[A-Z]{2}-\\d{2}$" }).valid,
    ).toBe(true);
    expect(fn("regex", { value: "ab", pattern: "^[A-Z]+$" }).valid).toBe(false);
    expect(fn("length", { value: "abc", min: 2, max: 3 }).valid).toBe(true);
    expect(fn("length", { value: "abcd", max: 3 })).toEqual({
      valid: false,
      message: "At most 3 characters",
    });
    expect(fn("numeric", { value: "7", min: 1, max: 10 }).valid).toBe(true);
    expect(fn("numeric", { value: "x" }).valid).toBe(false);
    expect(fn("numeric", { value: 11, max: 10 }).message).toBe("At most 10");
    expect(fn("email", { value: "a@b.co" }).valid).toBe(true);
    expect(fn("email", { value: "a@b" }).valid).toBe(false);
  });

  it("formats numbers, currency and dates", () => {
    expect(fn("formatNumber", { value: 1234567.891 })).toBe("1,234,567.891");
    expect(
      fn("formatNumber", { value: 1234.5, decimals: 2, grouping: false }),
    ).toBe("1234.50");
    expect(fn("formatCurrency", { value: 12.5, currency: "EUR" })).toBe(
      "€12.50",
    );
    expect(
      fn("formatCurrency", { value: 1200, currency: "JPY", decimals: 0 }),
    ).toBe("¥1,200");
    expect(
      fn("formatDate", { value: "2026-10-19", format: "yyyy-MM-dd" }),
    ).toBe("2026-10-19");
    expect(
      fn("formatDate", {
        value: "2026-10-19T14:05:09",
        format: "MMM d, yyyy HH:mm",
      }),
    ).toBe("Oct 19, 2026 14:05");
    expect(
      fn("formatDate", {
        value: "2026-10-19T14:05:00",
        format: "h:mm a 'o''clock'",
      }),
    ).toBe("2:05 PM o'clock");
    expect(fn("formatDate", { value: "2026-10-19", format: "EEEE" })).toBe(
      "Monday",
    );
    expect(
      fn("formatDate", { value: "2026-11-07", format: "EEE, MMM d" }),
    ).toBe("Sat, Nov 7");
    expect(
      fn("formatDate", { value: "2026-11-07", format: "d/M/yy 'at' HH:mm" }),
    ).toBe("7/11/26 at 00:00");
  });

  it("pluralizes by the locale category, with zero first", () => {
    const args = { zero: "none", one: "item", other: "items" };
    expect(fn("pluralize", { value: 0, ...args })).toBe("none");
    expect(fn("pluralize", { value: 1, ...args })).toBe("item");
    expect(fn("pluralize", { value: 5, ...args })).toBe("items");
    expect(fn("pluralize", { value: 1, other: "items" })).toBe("items");
  });

  it("rejects bad arguments with an ExpressionError", () => {
    expect(() => fn("formatCurrency", { value: 1 })).toThrow(ExpressionError);
    expect(() => fn("formatCurrency", { value: 1, currency: "nope" })).toThrow(
      "not a currency code",
    );
    expect(() => fn("formatDate", { value: "yesterday", format: "d" })).toThrow(
      "must be a date",
    );
    expect(() => fn("regex", { value: "a", pattern: "(" })).toThrow(
      "not a regular expression",
    );
    expect(() => fn("and", { values: true })).toThrow("values must be a list");
  });
});

describe("openUrl", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens http(s) URLs in a new tab with noopener, and refuses other schemes", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    openUrlSafely("https://example.com/docs");
    expect(open).toHaveBeenCalledWith(
      "https://example.com/docs",
      "_blank",
      "noopener,noreferrer",
    );
    openUrlSafely("/relative");
    expect(open).toHaveBeenLastCalledWith(
      `${window.location.origin}/relative`,
      "_blank",
      "noopener,noreferrer",
    );
    // eslint-disable-next-line no-script-url
    expect(() => openUrlSafely("javascript:alert(1)")).toThrow(
      "only http(s) URLs",
    );
    expect(() => openUrlSafely("data:text/html,hi")).toThrow(
      "only http(s) URLs",
    );
    expect(() => openUrlSafely(42)).toThrow("url must be a string");
    expect(open).toHaveBeenCalledTimes(2);
  });
});
