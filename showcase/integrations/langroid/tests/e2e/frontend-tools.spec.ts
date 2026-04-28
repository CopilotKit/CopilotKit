import { test, expect } from "@playwright/test";

test.describe("Frontend Tools", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools");
  });

  test("background container visible with default background", async ({
    page,
  }) => {
    await expect(
      page.locator('[data-testid="background-container"]'),
    ).toBeVisible();
  });

  test("background change request updates background style", async ({
    page,
  }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Change the background to a blue-to-purple gradient");
    await input.press("Enter");
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
    const bg = page.locator('[data-testid="background-container"]');
    await expect(bg).not.toHaveCSS("background-color", "rgb(250, 250, 249)", {
      timeout: 15000,
    });
  });
});
