import { test, expect } from "@playwright/test";

test.describe("Prebuilt Popup", () => {
  test("page loads with main content and popup launcher", async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
    await expect(
      page.getByText("Popup demo — look for the floating launcher"),
    ).toBeVisible();
    await expect(
      page.getByPlaceholder("Ask the popup anything..."),
    ).toBeVisible();
  });
});
