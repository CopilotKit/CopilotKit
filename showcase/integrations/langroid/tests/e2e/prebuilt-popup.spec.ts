import { test, expect } from "@playwright/test";

test.describe("Prebuilt Popup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
  });

  test("main content heading visible", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Popup demo/i }),
    ).toBeVisible();
  });

  test("popup chat input is visible (defaultOpen)", async ({ page }) => {
    await expect(
      page.getByPlaceholder("Ask the popup anything..."),
    ).toBeVisible({ timeout: 10000 });
  });
});
