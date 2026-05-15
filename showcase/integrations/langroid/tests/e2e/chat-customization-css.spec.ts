import { test, expect } from "@playwright/test";

test.describe("Chat Customization (CSS)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
  });

  test("themed scope wrapper is visible", async ({ page }) => {
    await expect(page.locator(".chat-css-demo-scope").first()).toBeVisible();
  });

  test("chat input is visible", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("sends a message and gets a reply", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("hello");
    await input.press("Enter");
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });
});
