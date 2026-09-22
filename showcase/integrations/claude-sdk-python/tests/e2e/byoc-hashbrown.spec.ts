import { test, expect } from "@playwright/test";

test.describe("BYOC hashbrown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-hashbrown");
  });

  test("header renders", async ({ page }) => {
    await expect(page.getByText("BYOC: Hashbrown")).toBeVisible();
  });

  test("chat composer is visible", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
