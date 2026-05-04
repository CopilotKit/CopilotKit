import { test, expect } from "@playwright/test";

test.describe("Tool-Based Generative UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/gen-ui-tool-based");
  });

  test("page loads with sidebar open", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("sidebar header shows Haiku Generator title", async ({ page }) => {
    await expect(page.getByText("Haiku Generator")).toBeVisible({
      timeout: 10000,
    });
  });

  test("haiku request renders haiku card", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Write me a haiku about nature");
    await input.press("Enter");

    // Haiku cards contain Japanese and English lines
    await expect(
      page
        .locator(
          '[data-testid="haiku-japanese-line"], [data-testid="haiku-english-line"]',
        )
        .first(),
    ).toBeVisible({ timeout: 60000 });
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
