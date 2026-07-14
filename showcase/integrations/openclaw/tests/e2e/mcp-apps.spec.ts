import { test, expect } from "@playwright/test";

// Behavioral e2e for the mcp-apps demo (OpenClaw), run against aimock
// (deterministic LLM). The gateway injects X-AIMock-Context: openclaw, so
// these prompts match the fixtures in showcase/aimock/d4/openclaw/chat.json.
//
// Pattern: MCP server-driven UI via ACTIVITY RENDERERS. The runtime
// (src/app/api/copilotkit-mcp-apps/route.ts) is wired with
// `mcpApps.servers` pinned to the public Excalidraw MCP app
// (serverId: "excalidraw", https://mcp.excalidraw.com). When the model calls
// the MCP-backed `create_view` tool, the MCP Apps middleware fetches the
// associated UI resource and emits an activity event; the built-in
// `MCPAppsActivityRenderer` (auto-registered by CopilotKitProvider — see the
// @region[no-frontend-renderer-needed] comment on page.tsx) paints a
// sandboxed <iframe> inline in the chat. The app registers NO custom activity
// renderer and NO data-testid, so the render-signal is the sandboxed
// `iframe[sandbox]` element itself.
//
// OpenClaw specifics:
//  - ag-ui FLATTENS the whole AG-UI conversation into one user prompt, so a
//    tool result arrives as the text "Tool <name> returned: ..." rather than a
//    role:tool message. aimock's `hasToolResult` discriminator therefore never
//    fires on the follow-up; the shared `{ userMessage: "returned:" }`
//    TERMINATOR fixture (first entry in chat.json) closes the tool-call loop.
//  - `create_view` is a server-side MCP tool (provided by the mcpApps wiring),
//    not a `useFrontendTool`. The fixtures below key on distinctive substrings
//    of each suggestion message and emit a single `create_view` toolCall so the
//    MCP middleware fetches the Excalidraw UI resource and mounts the iframe.
//
// The iframe render depends on a LIVE server-side fetch to
// https://mcp.excalidraw.com. That round-trip (create_view -> resource fetch
// -> activity event -> iframe) is slow and flaky on CI/Railway and can fail to
// paint an iframe when Excalidraw upstream is slow — the same instability the
// hermes reference spec documents. The two iframe-render tests are therefore
// SKIPPED (kept, ready to un-skip once the MCP Apps upstream stabilises); the
// deterministic frontend assertions (page load, no first-paint iframe, both
// suggestion pills) run un-skipped.

test.describe("MCP Apps (Excalidraw activity iframe)", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/mcp-apps");
  });

  test("page loads with a chat input and no activity iframe on first paint", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 20000,
    });
    // No sandboxed iframe before any tool call.
    await expect(page.locator("iframe[sandbox]")).toHaveCount(0);
  });

  test("both suggestion pills render with verbatim titles", async ({
    page,
  }) => {
    for (const title of ["Draw a flowchart", "Sketch a system diagram"]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  // SKIP: the flowchart pill's iframe depends on the live MCP round-trip
  // (create_view -> server-side Excalidraw resource fetch -> activity event ->
  // iframe). On CI/Railway this regularly sits above 90s and intermittently
  // fails to paint. Un-skip when the MCP Apps middleware / Excalidraw upstream
  // stabilises. The `create_view` fixture keyed on "draw a simple flowchart"
  // drives this deterministically once the round-trip is reliable.
  test.skip("Draw-a-flowchart pill renders a sandboxed activity iframe", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Draw a flowchart" }).click();

    // The built-in MCPAppsActivityRenderer always sets the `sandbox`
    // attribute on the UI-resource iframe — the load-bearing renderer contract.
    const iframe = page.locator("iframe[sandbox]").first();
    await expect(iframe).toBeVisible({ timeout: 90_000 });
  });

  // SKIP: same root cause as the flowchart flow — the system-diagram pill also
  // depends on the MCP round-trip. Driven by the `create_view` fixture keyed on
  // "sketch a system diagram".
  test.skip("Sketch-a-system-diagram pill renders a sandboxed activity iframe", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Sketch a system diagram" }).click();

    const iframe = page.locator("iframe[sandbox]").first();
    await expect(iframe).toBeVisible({ timeout: 90_000 });
  });
});
