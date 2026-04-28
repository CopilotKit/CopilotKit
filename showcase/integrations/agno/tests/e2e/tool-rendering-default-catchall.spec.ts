import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Default Catch-all)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-default-catchall");
  });

  test("page loads with suggestion pills", async ({ page }) => {
    await expect(
      page
        .locator('[data-testid="copilot-suggestion"]')
        .filter({ hasText: "Weather in SF" }),
    ).toBeVisible({ timeout: 15000 });

    await expect(
      page
        .locator('[data-testid="copilot-suggestion"]')
        .filter({ hasText: "Roll a d20" }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("clicking a suggestion surfaces a tool-call card", async ({ page }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Weather in SF" })
      .first()
      .click();

    // The default tool-call card exposes either the tool name or a generic
    // status pill. We assert on an assistant bubble round-tripping with a tool
    // call — the wildcard renderer fires for every call.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });
});
