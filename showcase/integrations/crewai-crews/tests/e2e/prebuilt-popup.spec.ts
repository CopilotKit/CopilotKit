import { test, expect } from "@playwright/test";

test.describe("Pre-Built Popup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
  });

  test("main content heading renders", async ({ page }) => {
    await expect(
      page.getByText("Popup demo — look for the floating launcher"),
    ).toBeVisible();
  });

  test("popup is open by default", async ({ page }) => {
    await expect(
      page.getByPlaceholder("Ask the popup anything..."),
    ).toBeVisible();
  });
});
