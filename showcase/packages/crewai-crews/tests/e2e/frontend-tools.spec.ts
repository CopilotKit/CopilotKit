import { test, expect } from "@playwright/test";

test.describe("Frontend Tools", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools");
  });

  test("background container and chat are visible", async ({ page }) => {
    await expect(
      page.locator('[data-testid="background-container"]'),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
