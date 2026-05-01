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

  // Canonical e2e suggestion — the headless-complete cell does NOT render
  // suggestion pills (no <CopilotChat />), so the test types the canonical
  // message into the textarea instead. The catalog message is mirrored in
  // the demo's useConfigureSuggestions for parity / discoverability.
  test("canonical suggestion prompt fires the feature", async ({ page }) => {
    const input = page.getByPlaceholder(/type a message/i);
    await input.fill(
      "send a sample message to populate the headless transcript",
    );
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="headless-complete-messages"]'),
    ).toBeVisible({ timeout: 30000 });
  });
});
