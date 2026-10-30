import { describe, expect, test } from "vitest";
import { layoutStyle, sizeOf } from "../style";

describe("sizeOf", () => {
  test("a number is a count of 4px steps", () => {
    expect(sizeOf(3)).toBe("12px");
  });

  test("a string passes through as CSS", () => {
    expect(sizeOf("50%")).toBe("50%");
  });

  test("undefined stays undefined", () => {
    expect(sizeOf(undefined)).toBeUndefined();
  });
});

describe("layoutStyle", () => {
  test("maps spacing and background tokens to CSS", () => {
    expect(
      layoutStyle({ gap: 2, padding: 4, background: "surface-secondary" }),
    ).toEqual({
      gap: "8px",
      padding: "16px",
      background: "var(--a2ui-color-surface-secondary)",
    });
  });

  test("a border uses the border color token", () => {
    expect(layoutStyle({ border: true, borderColor: "danger" })).toEqual({
      border: "1px solid var(--a2ui-color-border-danger)",
    });
  });

  test("a raw CSS color passes through", () => {
    expect(layoutStyle({ background: "#ff0000" })).toEqual({
      background: "#ff0000",
    });
  });

  test("flush removes the padding", () => {
    expect(layoutStyle({ padding: 4, flush: true })).toEqual({ padding: 0 });
  });

  test("no props give no CSS", () => {
    expect(layoutStyle({})).toEqual({});
  });
});
