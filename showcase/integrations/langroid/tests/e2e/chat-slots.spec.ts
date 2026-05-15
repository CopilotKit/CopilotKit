import { test, expect } from "@playwright/test";

test.describe("Chat Slots", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-slots");
  });

  test("custom welcome screen slot renders", async ({ page }) => {
    await expect(
      page.locator('[data-testid="custom-welcome-screen"]'),
    ).toBeVisible({ timeout: 10000 });
  });

  test("custom disclaimer slot renders", async ({ page }) => {
    await expect(
      page.locator('[data-testid="custom-disclaimer"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("custom assistant message slot activates on reply", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("hello");
    await input.press("Enter");
    await expect(
      page.locator('[data-testid="custom-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
