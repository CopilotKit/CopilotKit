import { describe, expect, it } from "vitest";
import {
  FONT_FAMILY,
  STANDARD_CATALOG_ID,
  TEXT_SIZES,
  TITLE_SIZES,
  backgroundColor,
  borderColor,
  panelBackground,
  radius,
  spacing,
  textColor,
  textFont,
  titleFont,
} from "../tokens";
import { STANDARD_CSS } from "../styles";

describe("standard tokens", () => {
  it("maps numbers to 4px steps and passes strings through", () => {
    expect(spacing(3)).toBe("calc(var(--spacing, 0.25rem) * 3)");
    expect(spacing("12px")).toBe("12px");
    expect(spacing(undefined)).toBeUndefined();
  });

  it("maps radius tokens and passes raw values through", () => {
    expect(radius("lg")).toBe("var(--a2ui-radius-lg, 12px)");
    expect(radius("full")).toBe("9999px");
    expect(radius(6)).toBe("6px");
    expect(radius("3px 4px")).toBe("3px 4px");
    expect(radius(undefined)).toBeUndefined();
  });

  it("maps semantic colors and passes raw CSS through", () => {
    expect(textColor("secondary")).toBe(
      "var(--a2ui-color-text-secondary, #5d5d5d)",
    );
    expect(textColor("#123")).toBe("#123");
    expect(textColor(undefined)).toBeUndefined();
    expect(backgroundColor("surface-secondary")).toBe(
      "var(--a2ui-color-surface-secondary, #f7f7f8)",
    );
    expect(backgroundColor("rebeccapurple")).toBe("rebeccapurple");
    expect(borderColor("subtle")).toBe(
      "var(--a2ui-color-border-subtle, rgba(0, 0, 0, 0.05))",
    );
    expect(borderColor("default")).toBe(
      "var(--a2ui-color-border-default, rgba(0, 0, 0, 0.1))",
    );
  });

  it("does not read inherited object keys as tokens", () => {
    expect(textColor("constructor")).toBe("constructor");
    expect(radius("toString")).toBe("toString");
  });

  it("maps background and text tokens to their fallback values", () => {
    expect(backgroundColor("surface")).toBe("var(--a2ui-color-surface, #fff)");
    expect(backgroundColor("surface-soft")).toContain("#fcfcfc");
    expect(backgroundColor("surface-tertiary")).toContain("#ececec");
    expect(backgroundColor("info")).toContain("rgba(0, 104, 188, 0.08)");
    expect(backgroundColor("success-solid")).toContain("#00805d");
    expect(textColor("default")).toContain("#0d0d0d");
    expect(textColor("tertiary")).toContain("#8e8e8e");
  });

  it("gives a panel in a Card the inner panel fill or a lighter tint", () => {
    expect(panelBackground("surface-soft")).toBe(
      "var(--a2ui-color-panel, rgb(252, 252, 252))",
    );
    expect(panelBackground("danger")).toBe(
      "var(--a2ui-color-danger-soft, rgba(193, 50, 44, 0.06))",
    );
    expect(panelBackground("info-solid")).toBe(
      "var(--a2ui-color-info-solid, #0068bc)",
    );
    expect(panelBackground(undefined)).toBeUndefined();
  });

  it("has the size lists", () => {
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

  it("uses md as the default font size", () => {
    expect(titleFont()).toEqual({
      fontSize: "1em",
      lineHeight: 1.5,
      fontWeight: 600,
    });
    expect(textFont()).toEqual({ fontSize: "1em", lineHeight: 1.625 });
  });

  it("gives the type scale in em of the host size", () => {
    expect(titleFont("2xl")).toEqual({
      fontSize: "1.5em",
      lineHeight: 1.333,
      fontWeight: 600,
    });
    expect(titleFont("lg").fontSize).toBe("1.125em");
    expect(textFont("sm")).toEqual({ fontSize: ".875em", lineHeight: 1.429 });
    expect(textFont("3xs").fontSize).toBe(".625em");
    expect(textFont("2xs").fontSize).toBe(".6875em");
    expect(textFont("xs").fontSize).toBe(".75em");
    expect(textFont("lg").fontSize).toBe("1.125em");
    expect(FONT_FAMILY).toContain("-apple-system, ui-sans-serif, system-ui");
  });

  it("lets the surface inherit the typography of the host", () => {
    expect(STANDARD_CSS).toContain(".a2ui-surface{font:inherit;color:inherit}");
    expect(STANDARD_CSS).not.toContain("font-family");
    expect(STANDARD_CSS).toContain(
      ":where(.a2ui-surface) :where(h2){font-size:1.5em;font-weight:600;line-height:1.3}",
    );
    // The list reset belongs to the List component, not to Markdown.
    expect(STANDARD_CSS).not.toMatch(/\.a2ui-surface :is\(ul,ol\)/);
    expect(STANDARD_CSS).toContain(
      '[data-a2ui-row="between"]>[data-a2ui-text]:last-child:not(:first-child){text-align:right',
    );
  });

  it("gives a focusable scroll container a visible focus ring", () => {
    expect(STANDARD_CSS).toContain(
      "[data-a2ui-scroll]:focus-visible{outline:2px solid var(--a2ui-color-focus, #0285ff);outline-offset:2px}",
    );
  });

  it("uses the documented catalog id", () => {
    expect(STANDARD_CATALOG_ID).toBe("copilotkit/standard@1");
  });
});
