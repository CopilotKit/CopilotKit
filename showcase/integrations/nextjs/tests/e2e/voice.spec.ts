import { test, expect } from "@playwright/test";
import { frameworksSupportingDemo } from "../helpers/parity";

const DEMO = "voice";

for (const fw of frameworksSupportingDemo(DEMO)) {
  test.describe(`${fw} × ${DEMO}`, () => {
    test("page renders voice UI", async ({ page }) => {
      await page.goto(`/demos/${fw}/${DEMO}`);
      await expect(
        page.locator('[data-testid="voice-sample-audio"]'),
      ).toBeVisible({ timeout: 15_000 });
    });

    test("sample audio button is present", async ({ page }) => {
      await page.goto(`/demos/${fw}/${DEMO}`);
      await expect(
        page.locator('[data-testid="voice-sample-audio-button"]'),
      ).toBeVisible({ timeout: 15_000 });
    });
  });
}
