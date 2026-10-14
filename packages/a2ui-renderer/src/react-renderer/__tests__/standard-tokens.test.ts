import { describe, expect, it } from "vitest";
import {
  spacing,
  radius,
  textColor,
  backgroundColor,
  borderColor,
  titleFont,
  textFont,
  TITLE_SIZES,
  TEXT_SIZES,
  STANDARD_CATALOG_ID,
} from "../a2ui-react/catalog/standard/tokens";

describe("standard tokens", () => {
  it("maps numbers to 4px steps and passes strings through", () => {
    expect(spacing(3)).toBe("calc(var(--spacing, 0.25rem) * 3)");
    expect(spacing("12px")).toBe("12px");
    expect(spacing(undefined)).toBeUndefined();
  });
  it("maps radius tokens and passes raw values", () => {
    expect(radius("lg")).toBe("var(--a2ui-radius-lg, 12px)");
    expect(radius("full")).toBe("9999px");
    expect(radius(6)).toBe("6px");
    expect(radius("3px 4px")).toBe("3px 4px");
    expect(radius(undefined)).toBeUndefined();
  });
  it("maps semantic colors and passes raw CSS", () => {
    expect(textColor("secondary")).toBe(
      "var(--a2ui-color-text-secondary, #676767)",
    );
    expect(textColor("#123")).toBe("#123");
    expect(backgroundColor("surface-secondary")).toContain(
      "--a2ui-color-surface-secondary",
    );
    expect(backgroundColor("rebeccapurple")).toBe("rebeccapurple");
    expect(borderColor("subtle")).toContain("--a2ui-color-border-subtle");
    expect(textColor(undefined)).toBeUndefined();
  });
  it("exposes the size enums", () => {
    expect(TITLE_SIZES).toEqual([
      "sm",
      "md",
      "lg",
      "xl",
      "2xl",
      "3xl",
      "4xl",
      "5xl",
    ]);
    expect(TEXT_SIZES).toEqual(["3xs", "2xs", "xs", "sm", "md", "lg"]);
  });
  it("defaults font helpers to md", () => {
    expect(titleFont().fontSize).toBe(titleFont("md").fontSize);
    expect(textFont().fontSize).toBe(16);
  });
  it("uses the documented catalog id", () => {
    expect(STANDARD_CATALOG_ID).toBe(
      "https://copilotkit.ai/a2ui/catalogs/standard/v1",
    );
  });
});
