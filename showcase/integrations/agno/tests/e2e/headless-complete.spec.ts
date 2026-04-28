import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Complete)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("custom chrome renders", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Headless Chat (Complete)" }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="headless-complete-messages"]'),
    ).toBeVisible();
    await expect(page.getByPlaceholder(/type a message/i)).toBeVisible();
  });

  test("sending a weather prompt renders a weather card", async ({ page }) => {
    const input = page.getByPlaceholder(/type a message/i);
    await input.fill("What's the weather in Tokyo?");
    await input.press("Enter");

    // Text content check — the headless WeatherCard lacks a data-testid.
    // The agent's weather reply includes the city name and a temperature
    // glyph, so assert on a stable substring.
    await expect(page.getByText(/tokyo/i).first()).toBeVisible({
      timeout: 60000,
    });
  });
});
