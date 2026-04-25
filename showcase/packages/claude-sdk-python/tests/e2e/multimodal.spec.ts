import { test, expect } from "@playwright/test";

test.describe("Multimodal attachments", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/multimodal");
  });

  test("demo root is visible", async ({ page }) => {
    await expect(
      page.locator('[data-testid="multimodal-demo-root"]'),
    ).toBeVisible();
  });

  test("both sample buttons render", async ({ page }) => {
    await expect(
      page.locator('[data-testid="multimodal-sample-image-button"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="multimodal-sample-pdf-button"]'),
    ).toBeVisible();
  });
});
