import { expect, test } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Demo source: src/app/demos/[integration]/mcp-apps/page.tsx
// Runtime: `mcpApps.servers` in src/demo-runtime-options.ts connects the MCP
// server at MCP_SERVER_URL (by default the public Excalidraw MCP app at
// https://mcp.excalidraw.com, with the pinned serverId "excalidraw").
//
// Pattern: MCP server-driven UI through ACTIVITY RENDERERS. The runtime
// middleware fetches the UI resource of the `create_view` MCP tool call
// and emits an activity event. CopilotKit's built-in
// `MCPAppsActivityRenderer` registers itself for the `mcp-apps` activity
// type (see `@region[no-frontend-renderer-needed]` in page.tsx) and paints
// a sandboxed <iframe> inline in the chat transcript.
//
// The app registers NO custom activity renderer and NO data-testid. The
// render signal is the sandboxed <iframe> element itself: the built-in
// renderer always sets the `sandbox` attribute. The iframe payload (the
// Excalidraw drawing) renders inside a cross-origin frame that Playwright
// cannot read from the page, so the tests only check that the iframe is
// there and keeps the sandbox contract.
//
// W8-9: the MCP round-trip (agent -> create_view -> server-side resource
// fetch -> activity event) is the slowest flow in the suite on Railway,
// and regularly takes more than 60s. The tool-driven tests below have a
// 90s budget.

describeDemo("mcp-apps", "MCP Apps (Excalidraw activity iframe)", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("mcp-apps"));
  });

  test("page loads with chat input and no activity iframe rendered", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    // No sandboxed iframe on first paint.
    await expect(page.locator("iframe[sandbox]")).toHaveCount(0);
  });

  test("both suggestion pills render with verbatim titles", async ({
    page,
  }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await expect(
      suggestions.filter({ hasText: "Draw a flowchart" }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      suggestions.filter({ hasText: "Sketch a system diagram" }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  // SKIP: on Railway the MCP round-trip (agent -> create_view ->
  // server-side resource fetch -> activity event -> iframe render)
  // regularly takes more than 90s, and sometimes paints no iframe at all
  // when the Excalidraw MCP server is slow. See W8-9. Un-skip when the
  // MCP Apps middleware and the Excalidraw upstream are stable on Railway.
  test.skip("Draw-a-flowchart pill renders a sandboxed activity iframe", async ({
    page,
  }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await suggestions.filter({ hasText: "Draw a flowchart" }).first().click();

    // The built-in MCPAppsActivityRenderer always sets the `sandbox`
    // attribute on the UI-resource iframe. That is the renderer contract
    // that every renderer keeps.
    const iframe = page.locator("iframe[sandbox]").first();
    await expect(iframe).toBeVisible({ timeout: 90_000 });
  });

  // SKIP: same root cause as the flowchart flow. The typed-prompt variant
  // also depends on the MCP round-trip. See W8-9.
  test.skip("explicit create_view prompt renders a sandboxed iframe", async ({
    page,
  }) => {
    // A typed prompt, not a suggestion pill: the canonical end-to-end MCP
    // interaction, a single `create_view` call with 3 elements.
    const input = page.getByPlaceholder("Type a message");
    await input.fill(
      "Use Excalidraw to draw exactly 2 rectangles labelled 'A' and 'B' connected by one arrow from A to B.",
    );
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const iframe = page.locator("iframe[sandbox]").first();
    await expect(iframe).toBeVisible({ timeout: 90_000 });
  });
});
