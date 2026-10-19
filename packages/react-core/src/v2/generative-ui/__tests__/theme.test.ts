import { describe, expect, it } from "vitest";
import { DARK_THEME_CSS, themeStyleSheet } from "../theme";
import type { GenerativeUITheme } from "../theme";

describe("themeStyleSheet", () => {
  it("gives nothing for a theme without variables", () => {
    expect(themeStyleSheet(undefined)).toBeUndefined();
    expect(themeStyleSheet({ mapStyle: "https://x/style" })).toBeUndefined();
  });

  it("puts top-level values on the themed surface and dark values in dark mode", () => {
    const sheet = themeStyleSheet({
      "--a2ui-color-accent": "#d97706",
      dark: { "--a2ui-color-panel": "#1f2937", mapStyle: "https://x/dark" },
    })!;
    const self = `[data-a2ui-theme="${sheet.id}"]`;
    expect(sheet.css).toBe(
      `${self}{--a2ui-color-accent:#d97706}:where(.dark) ${self},${self}:where(.dark){--a2ui-color-panel:#1f2937}`,
    );
  });

  it("gives the same id for the same theme, and another id for another theme", () => {
    const theme: GenerativeUITheme = { "--a2ui-color-accent": "red" };
    expect(themeStyleSheet(theme)!.id).toBe(themeStyleSheet({ ...theme })!.id);
    expect(themeStyleSheet(theme)!.id).not.toBe(
      themeStyleSheet({ "--a2ui-color-accent": "blue" })!.id,
    );
  });

  it("leaves out values and names that could break out of the rule", () => {
    const theme = {
      "--a2ui-color-accent": "red}</style><script>alert(1)</script>",
      "--a2ui-color-panel": "#fff;color:red",
      "color: red; --a2ui-x": "#000",
      "--a2ui-color-focus": "#3b9bff",
    } as GenerativeUITheme;
    const sheet = themeStyleSheet(theme)!;
    expect(sheet.css).toBe(
      `[data-a2ui-theme="${sheet.id}"]{--a2ui-color-focus:#3b9bff}`,
    );
  });
});

describe("the built-in dark values", () => {
  it("apply under a .dark class, with no specificity, so any theme rule wins", () => {
    expect(
      DARK_THEME_CSS.startsWith(
        ":where(.dark .a2ui-surface,.a2ui-surface.dark){",
      ),
    ).toBe(true);
    expect(DARK_THEME_CSS).toContain("--a2ui-color-surface:#1f1f1f");
  });
});
