import { test, expect } from "@playwright/test";

test.describe("Tool-Based Generative UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/gen-ui-tool-based");
  });

  test("page loads with sidebar open and dashboard", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Weather Dashboard")).toBeVisible();
  });

  test("sidebar header shows Weather Assistant title", async ({ page }) => {
    await expect(page.getByText("Weather Assistant")).toBeVisible({
      timeout: 10000,
    });
  });

  test("sends message and gets assistant response", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Hello");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });
});
