import { test, expect } from "@playwright/test";

test.describe("Prebuilt Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-sidebar");
  });

  test("main content heading visible", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Sidebar demo/i }),
    ).toBeVisible();
  });

  test("sidebar chat input is visible (defaultOpen)", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
