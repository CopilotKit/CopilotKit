import { test, expect } from "@playwright/test";

test.describe("Pre-Built Popup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
  });

  test("page loads with main content heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Popup demo/ }),
    ).toBeVisible();
  });

  test("popup is open by default with custom placeholder", async ({ page }) => {
    await expect(
      page.getByPlaceholder("Ask the popup anything..."),
    ).toBeVisible({ timeout: 10000 });
  });
});
