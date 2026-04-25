import { test, expect } from "@playwright/test";

test.describe("Pre-Built Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-sidebar");
  });

  test("page loads with main content and sidebar", async ({ page }) => {
    await expect(
      page.getByText("Sidebar demo — click the launcher"),
    ).toBeVisible();
  });

  test("sidebar chat input is present by default", async ({ page }) => {
    // Sidebar opens by default, so the chat input should be reachable.
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
