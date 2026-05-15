import { test, expect } from "@playwright/test";

test.describe("Pre-Built Popup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
  });

  test("page loads with popup launcher content", async ({ page }) => {
    await expect(
      page.getByText("Popup demo — look for the floating launcher"),
    ).toBeVisible();
  });

  test("popup chat input is reachable", async ({ page }) => {
    // defaultOpen={true} — the popup chat input should be on the page.
    await expect(
      page.getByPlaceholder("Ask the popup anything..."),
    ).toBeVisible({ timeout: 10000 });
  });
});
