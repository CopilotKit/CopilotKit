import { test, expect } from "@playwright/test";
import { frameworksSupportingDemo } from "../helpers/parity";

const DEMO = "multimodal";

for (const fw of frameworksSupportingDemo(DEMO)) {
  test.describe(`${fw} × ${DEMO}`, () => {
    test("page renders attachment UI", async ({ page }) => {
      await page.goto(`/demos/${fw}/${DEMO}`);
      await expect(
        page.locator('[data-testid="multimodal-demo-root"]'),
      ).toBeVisible({ timeout: 15_000 });
    });

    test("sample attachment buttons are visible", async ({ page }) => {
      await page.goto(`/demos/${fw}/${DEMO}`);
      await expect(
        page.locator('[data-testid="multimodal-sample-row"]'),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.locator('[data-testid="multimodal-sample-image-button"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="multimodal-sample-pdf-button"]'),
      ).toBeVisible();
    });
  });
}
