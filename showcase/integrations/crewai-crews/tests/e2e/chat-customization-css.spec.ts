import { test, expect } from "@playwright/test";

test.describe("Chat Customization (CSS)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
  });

  test("scoped wrapper class is present", async ({ page }) => {
    const scope = page.locator(".chat-css-demo-scope");
    await expect(scope).toHaveCount(1);
  });

  test("chat input is visible", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
