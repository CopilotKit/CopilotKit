import { test, expect } from "@playwright/test";

test.describe("Tool Rendering + Reasoning Chain", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-reasoning-chain");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("weather request renders weather card", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("What's the weather in Tokyo?");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="weather-card"]').first(),
    ).toBeVisible({
      timeout: 45000,
    });
  });

  test("flight search renders flight list card", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Find flights from SFO to JFK.");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="flight-list-card"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });
});
