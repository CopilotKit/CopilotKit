import { test, expect } from "@playwright/test";

test.describe("Frontend Tools (Async)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools-async");
  });

  test("chat input is visible", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("query request renders notes card with matching keyword", async ({
    page,
  }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Find my notes about project planning.");
    await input.press("Enter");
    await expect(
      page.locator('[data-testid="notes-card"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });
});
