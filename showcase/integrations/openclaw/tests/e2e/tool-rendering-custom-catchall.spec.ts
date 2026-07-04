import { test, expect } from "@playwright/test";

// Behavioral e2e for the tool-rendering-custom-catchall demo (OpenClaw), run
// against aimock.
//
// This demo opts out of CopilotKit's built-in default tool UI and registers a
// single BRANDED wildcard renderer via `useDefaultRenderTool` that paints ANY
// tool call as an app-designed card (custom-catchall-renderer.tsx). Distinct
// testids (prefix `custom-catchall-tr-`) keep it from clashing with the
// sibling `tool-rendering` demo:
//   data-testid="custom-catchall-tr-card"        (outer, with data-tool-name / data-status)
//   data-testid="custom-catchall-tr-tool-name"
//   data-testid="custom-catchall-tr-args"
//   data-testid="custom-catchall-tr-status"
//   data-testid="custom-catchall-tr-result"      (only once status === complete)
//
// IMPORTANT / UNCERTAINTY: in production OpenClaw executes its OWN server-side
// tools (shell exec, file read, etc.) for real — the exact tool NAMES and
// ARGUMENT SCHEMAS are not verified here. The aimock fixtures in
// showcase/aimock/d4/openclaw/chat.json use BEST-EFFORT names ("read" with
// {path}, "exec" with {command}). Because the catch-all renderer keys off the
// stable data-testid and not the tool identity, these tests assert that A card
// renders — not that a specific tool name/arg shape appears.
test.describe("Tool Rendering — Custom Catch-all (branded wildcard renderer)", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-custom-catchall");
  });

  test("page loads with chat input and tool suggestions", async ({ page }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 20000,
    });
    for (const title of ["List files", "Read a file", "System info"]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("'Read a file' pill renders a branded catch-all tool-call card", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Read a file" }).click();

    // The wildcard renderer paints a card for the emitted tool call. Assert on
    // the stable testid rather than the (uncertain) server-tool name.
    const card = page
      .locator('[data-testid="custom-catchall-tr-card"]')
      .first();
    await expect(card).toBeVisible({ timeout: 45000 });
    await expect(
      card.locator('[data-testid="custom-catchall-tr-tool-name"]'),
    ).toBeVisible();
    await expect(
      card.locator('[data-testid="custom-catchall-tr-args"]'),
    ).toBeVisible();
  });

  test("typing a tool-y prompt renders a catch-all card and an assistant reply", async ({
    page,
  }) => {
    const input = page.getByRole("textbox").first();
    await input.fill("List the files in the current directory.");
    await input.press("Enter");

    const card = page
      .locator('[data-testid="custom-catchall-tr-card"]')
      .first();
    await expect(card).toBeVisible({ timeout: 45000 });

    // After the tool result flows back, the second-call fixture returns a
    // text summary — an assistant bubble should follow.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });
});
