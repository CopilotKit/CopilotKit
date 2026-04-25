import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Simple)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("page loads without runtime errors", async ({ page }) => {
    // The custom headless surface renders its own input; we just verify no
    // runtime errors by checking the main element exists.
    await expect(page.locator("main").first()).toBeVisible({ timeout: 15000 });
  });
});
