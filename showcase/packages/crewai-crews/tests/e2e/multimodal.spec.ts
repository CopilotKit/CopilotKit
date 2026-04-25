import { test, expect } from "@playwright/test";

test.describe("Multimodal Attachments", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/multimodal");
  });

  test("sample-row and buttons render", async ({ page }) => {
    await expect(
      page.locator('[data-testid="multimodal-sample-row"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="multimodal-sample-image-button"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="multimodal-sample-pdf-button"]'),
    ).toBeVisible();
  });

  test("demo-root wrapper is present", async ({ page }) => {
    await expect(
      page.locator('[data-testid="multimodal-demo-root"]'),
    ).toBeVisible();
  });
});
