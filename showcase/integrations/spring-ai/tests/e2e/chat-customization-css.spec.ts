import { test, expect } from "@playwright/test";

test.describe("Chat Customization (CSS)", () => {
  test("page loads with scoped wrapper", async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
    await expect(page.locator(".chat-css-demo-scope")).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
