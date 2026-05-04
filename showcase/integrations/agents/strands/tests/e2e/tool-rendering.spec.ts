import { test, expect } from "@playwright/test";

test.describe("Tool Rendering", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("sends message and gets assistant response", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });

  test("weather query renders WeatherCard with stats grid", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("What's the weather in London?");
    await input.press("Enter");

    // WeatherCard has gradient background, rounded corners, and shadow
    const weatherCard = page.locator('[data-testid="weather-card"]').first();
    await expect(weatherCard).toBeVisible({ timeout: 45000 });

    // Verify the 3-column stats grid is present (Humidity, Wind, Feels Like)
    await expect(weatherCard.getByText("Humidity")).toBeVisible({
      timeout: 5000,
    });
    await expect(weatherCard.getByText("Wind")).toBeVisible({ timeout: 5000 });
    await expect(weatherCard.getByText("Feels Like")).toBeVisible({
      timeout: 5000,
    });
  });

  test("completed weather card shows Current Weather label", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Tell me the weather in Paris");
    await input.press("Enter");

    const weatherCard = page.locator('[data-testid="weather-card"]').first();
    await expect(weatherCard).toBeVisible({ timeout: 45000 });

    // "Current Weather" label appears in the completed card header
    await expect(weatherCard.getByText("Current Weather")).toBeVisible({
      timeout: 5000,
    });
  });
});
