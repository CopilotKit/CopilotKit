import { test, expect } from "@playwright/test";

test.describe("Voice input", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/voice");
  });

  test("header and sample button render", async ({ page }) => {
    await expect(page.getByText("Voice input")).toBeVisible();
    await expect(
      page.locator('[data-testid="voice-sample-audio-button"]'),
    ).toBeVisible();
  });
});
