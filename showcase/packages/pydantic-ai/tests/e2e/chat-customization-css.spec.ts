import { test, expect } from "@playwright/test";

test.describe("Chat Customization (CSS)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
  });

  test("page loads with scoped chat container", async ({ page }) => {
    await expect(page.locator(".chat-css-demo-scope").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("chat input is visible", async ({ page }) => {
    await expect(page.locator("textarea").first()).toBeVisible({
      timeout: 10000,
    });
  });
});
