import { test, expect } from "@playwright/test";

test.describe("Agentic Chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agentic-chat");
  });

  test("page loads with chat input and background container", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(
      page.locator('[data-testid="background-container"]'),
    ).toBeVisible();
  });

  test("background container has default background style", async ({
    page,
  }) => {
    const bg = page.locator('[data-testid="background-container"]');
    await expect(bg).toHaveCSS("background-color", "rgb(250, 250, 249)");
  });

  test("sends message and gets assistant response", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Say hello");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });

  test("weather request renders WeatherCard with location and stats", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("What is the weather in Tokyo?");
    await input.press("Enter");

    // WeatherCard renders as a rounded-2xl div with shadow-xl and gradient background
    const weatherCard = page.locator('[data-testid="weather-card"]').first();
    await expect(weatherCard).toBeVisible({ timeout: 45000 });

    // Verify the card has weather detail sections (Humidity, Wind, Feels Like)
    await expect(weatherCard.getByText("Humidity")).toBeVisible({
      timeout: 5000,
    });
    await expect(weatherCard.getByText("Wind")).toBeVisible({ timeout: 5000 });
    await expect(weatherCard.getByText("Feels Like")).toBeVisible({
      timeout: 5000,
    });
  });

  test("background change request updates background style", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Change the background to a blue gradient");
    await input.press("Enter");

    // Wait for the agent to respond and process the tool call
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });

    // The background-container style should have changed from the default #fafaf9
    const bg = page.locator('[data-testid="background-container"]');
    await expect(bg).not.toHaveCSS("background-color", "rgb(250, 250, 249)", {
      timeout: 15000,
    });
  });
});
