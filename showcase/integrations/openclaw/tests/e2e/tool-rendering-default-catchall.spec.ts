import { test, expect } from "@playwright/test";

// Behavioral e2e for the tool-rendering-default-catchall demo (OpenClaw), run
// against aimock.
//
// This demo opts into CopilotKit's BUILT-IN default tool-call card via
// `useDefaultRenderTool()` (no config) — there is NO custom component. The
// package-provided `DefaultToolCallRenderer` renders every tool call with these
// stable markers:
//   data-testid="copilot-tool-render"         (outer, with data-tool-name / data-status)
//   data-testid="copilot-tool-render-name"
//   data-testid="copilot-tool-render-status"  (label "Running" → "Done")
//
// IMPORTANT / UNCERTAINTY: in production OpenClaw executes its OWN server-side
// tools (shell exec, file read, etc.) for real — the exact tool NAMES and
// ARGUMENT SCHEMAS are not verified here. The aimock fixtures in
// showcase/aimock/d4/openclaw/chat.json use BEST-EFFORT names ("read" with
// {path}, "exec" with {command}). Because the default renderer keys off the
// stable data-testid and not the tool identity, these tests assert that A card
// renders — not that a specific tool name/arg shape appears.
test.describe("Tool Rendering (default catch-all renderer)", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-default-catchall");
  });

  test("page loads with chat input and tool suggestions", async ({ page }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 20000,
    });
    for (const title of ["Read a file", "List files"]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("'Read a file' pill renders a built-in default tool-call card", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Read a file" }).click();

    // The built-in DefaultToolCallRenderer paints a card for the emitted tool
    // call. Assert on the stable package testid rather than the (uncertain)
    // server-tool name.
    const card = page.locator('[data-testid="copilot-tool-render"]').first();
    await expect(card).toBeVisible({ timeout: 45000 });
    await expect(
      card.locator('[data-testid="copilot-tool-render-name"]'),
    ).toBeVisible();
    await expect(
      card.locator('[data-testid="copilot-tool-render-status"]'),
    ).toBeVisible();
  });

  test("typing a tool-y prompt renders a default card and an assistant reply", async ({
    page,
  }) => {
    const input = page.getByRole("textbox").first();
    await input.fill("List the files in the current directory.");
    await input.press("Enter");

    const card = page.locator('[data-testid="copilot-tool-render"]').first();
    await expect(card).toBeVisible({ timeout: 45000 });

    // After the tool result flows back, the second-call fixture returns a
    // text summary — an assistant bubble should follow.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });
});
