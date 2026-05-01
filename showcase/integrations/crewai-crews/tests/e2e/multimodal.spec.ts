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

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Sample image suggestion pill renders an assistant message", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Sample image" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
