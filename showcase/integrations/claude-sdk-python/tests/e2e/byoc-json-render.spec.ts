import { test, expect } from "@playwright/test";

test.describe("BYOC json-render", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-json-render");
  });

  test("page loads with chat composer", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("suggestion pills are rendered", async ({ page }) => {
    await expect(
      page.getByText("Sales dashboard", { exact: false }).first(),
    ).toBeVisible({
      timeout: 10000,
    });
  });
});
