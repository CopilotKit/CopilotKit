import { test, expect } from "@playwright/test";

test.describe("Voice input", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/voice");
  });

  test("page loads with sample audio button", async ({ page }) => {
    await expect(
      page.locator('[data-testid="voice-sample-audio"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="voice-sample-audio-button"]'),
    ).toBeVisible();
  });
});
