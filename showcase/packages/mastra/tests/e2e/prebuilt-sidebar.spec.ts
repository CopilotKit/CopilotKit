import { test, expect } from "@playwright/test";

test.describe("Pre-Built Sidebar", () => {
  test("page loads and sidebar is visible", async ({ page }) => {
    await page.goto("/demos/prebuilt-sidebar");
    await expect(
      page.getByRole("heading", { name: /Sidebar demo/i }),
    ).toBeVisible();
  });
});
