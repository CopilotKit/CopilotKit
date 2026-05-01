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

  test("canonical 'Kyoto itinerary' suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
    const pill = page.getByRole("button", { name: /Kyoto itinerary/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
