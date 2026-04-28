import { test, expect } from "@playwright/test";

test.describe("Chat Customization (Slots)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-slots");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 15000,
    });
  });
});
