import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const sidebarCss = fs.readFileSync(
  path.resolve(__dirname, "sidebar.css"),
  "utf-8",
);
const sidebarTsx = fs.readFileSync(
  path.resolve(__dirname, "../components/chat/Sidebar.tsx"),
  "utf-8",
);

/**
 * Regression guard for #261: children of `CopilotSidebar` could not use
 * `height: 100%`, because both wrappers around them are auto-height blocks.
 * The fix is opt-in, so the guard has two halves — the escape hatch works,
 * and it stays off for everyone who didn't ask for it.
 */
describe("sidebar full-height children opt-in", () => {
  const fullHeightRule =
    /\.copilotKitSidebarContentWrapper\.copilotKitSidebarFullHeightChildren\s*\{([^}]*)\}/;
  const childrenWrapperRule =
    /\.copilotKitSidebarContentWrapper\.copilotKitSidebarFullHeightChildren\s*>\s*\.copilotKitModalChildrenWrapper\s*\{([^}]*)\}/;

  it("gives the content wrapper a definite height children can resolve against", () => {
    const [, body] = sidebarCss.match(fullHeightRule) ?? [];
    expect(body).toBeDefined();
    expect(body).toContain("display: flex");
    expect(body).toContain("flex-direction: column");
    // A viewport unit, not `100%` — `100%` would silently no-op in any app
    // that doesn't declare a height on html/body/#root.
    expect(body).toContain("height: 100dvh");
    expect(body).toContain("height: 100vh");
    expect(body).not.toMatch(/height:\s*100%/);
  });

  it("lets the children wrapper fill that height without a flex min-height floor", () => {
    const [, body] = sidebarCss.match(childrenWrapperRule) ?? [];
    expect(body).toBeDefined();
    expect(body).toContain("flex: 1 1 auto");
    expect(body).toContain("min-height: 0");
  });

  it("leaves the default content wrapper auto-height", () => {
    const [, base] =
      sidebarCss.match(/\.copilotKitSidebarContentWrapper\s*\{([^}]*)\}/) ?? [];
    expect(base).toBeDefined();
    expect(base).not.toContain("height");
    expect(base).not.toContain("display");
  });

  it("applies the modifier class only when fullHeightChildren is set", () => {
    expect(sidebarTsx).toContain("fullHeightChildren = false");
    expect(sidebarTsx).toMatch(
      /fullHeightChildren\s*\?\s*"copilotKitSidebarFullHeightChildren"\s*:\s*""/,
    );
  });
});
