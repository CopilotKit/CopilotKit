import { test, expect } from "@playwright/test";

test.describe("Frontend Tools", () => {
  test("page loads with background container", async ({ page }) => {
    await page.goto("/demos/frontend-tools");
    await expect(
      page.locator('[data-testid="background-container"]'),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
