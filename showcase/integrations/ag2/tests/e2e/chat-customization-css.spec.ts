import { test, expect } from "@playwright/test";

test.describe("Chat Customization (CSS)", () => {
  test("scoped theme wrapper is applied", async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
    await expect(page.locator(".chat-css-demo-scope")).toBeVisible();
  });
});
