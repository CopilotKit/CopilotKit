import { test, expect } from "@playwright/test";

// Smoke coverage for every OpenClaw demo route: the page mounts, the chat
// composer renders, and no uncaught page error fires. This is deliberately
// behavior-agnostic (no model calls) so it stays green without aimock
// fixtures; per-feature behavioral specs (tool calls, reasoning panel,
// frontend-tool round-trip) are a follow-up once fixtures are recorded.

const DEMOS = [
  "/demos/agentic-chat",
  "/demos/tool-rendering",
  "/demos/frontend-tools",
  "/demos/prebuilt-sidebar",
  "/demos/prebuilt-popup",
  "/demos/chat-customization-css",
];

for (const route of DEMOS) {
  test(`demo mounts without error: ${route}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(route);
    // A CopilotKit chat composer is present on every demo (sidebar/popup mount
    // it too). Give the client bundle time to hydrate.
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 20_000,
    });

    expect(errors, `uncaught page errors on ${route}`).toEqual([]);
  });
}
