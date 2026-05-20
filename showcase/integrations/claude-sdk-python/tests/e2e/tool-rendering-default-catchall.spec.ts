import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Default Catch-all)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-default-catchall");
  });

  test("chat input is reachable", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
