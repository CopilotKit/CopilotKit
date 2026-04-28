import { test, expect } from "@playwright/test";

test.describe("Frontend Tools", () => {
  test("background container is visible", async ({ page }) => {
    await page.goto("/demos/frontend-tools");
    await expect(
      page.locator('[data-testid="background-container"]'),
    ).toBeVisible();
  });
});
