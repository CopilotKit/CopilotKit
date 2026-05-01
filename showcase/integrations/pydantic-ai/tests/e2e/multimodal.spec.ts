import { test, expect } from "@playwright/test";

test.describe("Multimodal Attachments", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/multimodal");
  });

  test("page loads with sample row and composer", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Multimodal attachments" }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="multimodal-sample-row"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="multimodal-sample-image-button"]'),
    ).toBeEnabled();
    await expect(
      page.locator('[data-testid="multimodal-sample-pdf-button"]'),
    ).toBeEnabled();
    await expect(
      page.locator('[data-testid="copilot-chat-textarea"]'),
    ).toBeVisible();
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Sample image/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
