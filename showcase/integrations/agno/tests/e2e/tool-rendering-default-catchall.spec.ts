import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Default Catch-all)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-default-catchall");
  });

  test("page loads with the canonical suggestion pill", async ({ page }) => {
    await expect(
      page
        .locator('[data-testid="copilot-suggestion"]')
        .filter({ hasText: "Default catchall" }),
    ).toBeVisible({ timeout: 15000 });
  });

  // Canonical e2e suggestion — single "Default catchall" pill from
  // _canonical-catalog.json. Clicking it dispatches the canonical message
  // and the wildcard default-catchall renderer surfaces an assistant
  // message.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Default catchall" })
      .first()
      .click();

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });
});
