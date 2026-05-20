import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Reasoning Chain)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-reasoning-chain");
  });

  test("chat UI renders on load", async ({ page }) => {
    await expect(page.getByPlaceholder(/type a message/i)).toBeVisible();
  });

  test("weather prompt triggers reasoning + WeatherCard", async ({ page }) => {
    const input = page.getByPlaceholder(/type a message/i);
    await input.fill("What's the weather in Tokyo?");
    await input.press("Enter");

    // Custom reasoning block appears.
    await expect(
      page.locator('[data-testid="reasoning-block"]').first(),
    ).toBeVisible({ timeout: 60000 });

    // Per-tool WeatherCard renders.
    await expect(
      page.locator('[data-testid="weather-card"]').first(),
    ).toBeVisible({ timeout: 60000 });
  });

  test("dice prompt triggers the catch-all renderer", async ({ page }) => {
    const input = page.getByPlaceholder(/type a message/i);
    await input.fill("Roll a 20-sided die for me.");
    await input.press("Enter");

    await expect(
      page
        .locator(
          '[data-testid="custom-catchall-card"][data-tool-name="roll_dice"]',
        )
        .first(),
    ).toBeVisible({ timeout: 60000 });
  });
});
