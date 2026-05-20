import { test, expect } from "@playwright/test";

test.describe("Pre-Built Popup", () => {
  test("page loads and popup is visible", async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
    await expect(
      page.getByRole("heading", { name: /Popup demo/i }),
    ).toBeVisible();
  });
});
