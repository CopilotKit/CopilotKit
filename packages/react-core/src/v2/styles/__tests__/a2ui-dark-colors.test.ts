import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const themeCss = readFileSync("src/v2/styles/css/theme.css", {
  encoding: "utf8",
});

// The A2UI basic catalog paints its cards, chips and buttons with
// --a2ui-color-* variables whose fallbacks are light colours. In dark mode the
// chat sets them from its own tokens, the way the Angular stylesheet does, so a
// card's light text doesn't land on a white background.
describe("A2UI colours in dark mode", () => {
  const darkBlock =
    themeCss.match(
      /:where\(\s*\.dark \[data-copilotkit\],\s*\[data-copilotkit\]\.dark\s*\) \{([^}]*)\}/,
    )?.[1] ?? "";

  it("sets the A2UI surface, border, muted and error colours from the dark theme", () => {
    expect(darkBlock).toContain("--a2ui-color-surface: var(--card);");
    expect(darkBlock).toContain("--a2ui-color-border: oklch(0.371 0 0);");
    expect(darkBlock).toContain("--a2ui-color-muted: var(--muted-foreground);");
    expect(darkBlock).toContain("--a2ui-color-error: #f87171;");
  });

  it("leaves the light theme to the catalog's fallbacks", () => {
    const lightBlock =
      themeCss.match(/^:where\(\[data-copilotkit\]\) \{([^}]*)\}/m)?.[1] ?? "";
    expect(lightBlock).not.toContain("--a2ui-color-");
  });
});
