import { test, expect } from "@playwright/test";

test.describe("Voice Input", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/voice");
  });

  test("sample-audio affordance renders", async ({ page }) => {
    await expect(
      page.locator('[data-testid="voice-sample-audio"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="voice-sample-audio-button"]'),
    ).toBeVisible();
  });

  test("sample-audio button is clickable and does not crash the page", async ({
    page,
  }) => {
    const button = page.locator('[data-testid="voice-sample-audio-button"]');
    await button.click();
    // Button either returns to idle ("Play sample") or surfaces an error
    // banner — what matters is the page stays alive.
    await expect(button).toBeVisible();
  });
});
