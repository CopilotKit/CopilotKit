import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Resolved from the project root, not `import.meta.url`: under Vitest's Vite
// transform `import.meta.url` is not a file: URL, so `new URL(…)` throws.
const CSS = readFileSync(
  path.resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);

/**
 * Comments are stripped before any scanning. The migration comments in this
 * stylesheet legitimately *name* the selectors in prose, and a prose mention
 * must not register as a live rule — otherwise the "no attribute-scoped rules
 * survive" assertion below could never reach zero.
 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Selector lines that scope CHAT styling via the SDK's sidebar attribute.
 * The rail hack (`[data-position="left"]`) is excluded — it is deleted, not
 * re-keyed, because it only compensates for the fixed sidebar's geometry.
 */
function sidebarScopedChatSelectors(css: string): string[] {
  return withoutComments(css)
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.includes("[data-copilot-sidebar]") &&
        !line.includes('[data-position="left"]'),
    );
}

describe("chat CSS scoping", () => {
  it("scopes chat styling by .nw-chat", () => {
    // If this drops to 0 the extractor is broken, and the absence assertion
    // below would pass vacuously — on an empty file it would pass too.
    const scoped = withoutComments(CSS)
      .split("\n")
      .filter((line) => line.trim().startsWith(".nw-chat "));

    expect(scoped.length).toBeGreaterThan(20);
  });

  it("no longer scopes any chat styling by the removed SDK attribute", () => {
    // `CopilotSidebar` is gone, so nothing renders `[data-copilot-sidebar]` and
    // any surviving rule is dead code that silently fails to style the chat.
    // This is the closing half of the bracket opened when the `.nw-chat` twins
    // were added: the twins carry the typography, so these can go.
    expect(sidebarScopedChatSelectors(CSS)).toEqual([]);
  });
});
