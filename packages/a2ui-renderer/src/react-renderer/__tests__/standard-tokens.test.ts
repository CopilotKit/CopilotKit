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
  FONT_FAMILY,
} from "../a2ui-react/catalog/standard/tokens";
import { STANDARD_CSS } from "../a2ui-react/catalog/standard/styles";

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
      "var(--a2ui-color-text-secondary, #5d5d5d)",
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
    expect(textFont().fontSize).toBe("1em");
  });
  it("expresses ChatGPT's measured type scale in em of the host size", () => {
    expect(titleFont("2xl")).toMatchObject({
      fontSize: "1.5em",
      lineHeight: 1.333,
      fontWeight: 600,
    });
    expect(titleFont("lg")).toMatchObject({ fontSize: "1.125em" });
    expect(textFont("md")).toEqual({ fontSize: "1em", lineHeight: 1.625 });
    expect(textFont("sm")).toEqual({ fontSize: ".875em", lineHeight: 1.429 });
    expect(textFont("3xs").fontSize).toBe(".625em");
    expect(textFont("2xs").fontSize).toBe(".6875em");
    expect(textFont("xs").fontSize).toBe(".75em");
    expect(textFont("lg").fontSize).toBe("1.125em");
    expect(FONT_FAMILY).toContain("-apple-system, ui-sans-serif, system-ui");
    expect(borderColor("default")).toBe(
      "var(--a2ui-color-border-default, rgba(0, 0, 0, 0.1))",
    );
  });
  it("lets the surface inherit the host's typography", () => {
    expect(STANDARD_CSS).toContain(".a2ui-surface{font:inherit;color:inherit}");
    expect(STANDARD_CSS).not.toContain("font-family");
    expect(STANDARD_CSS).toContain(
      ":where(.a2ui-surface) :where(h2){font-size:1.5em;font-weight:600;line-height:1.3}",
    );
    // The list reset belongs to the List component, not to Markdown.
    expect(STANDARD_CSS).not.toMatch(/\.a2ui-surface :is\(ul,ol\)/);
  });
  it("uses the documented catalog id", () => {
    expect(STANDARD_CATALOG_ID).toBe(
      "https://copilotkit.ai/a2ui/catalogs/standard/v1",
    );
  });
});
