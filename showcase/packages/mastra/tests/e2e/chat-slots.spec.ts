import { test, expect } from "@playwright/test";

test.describe("Chat Slots", () => {
  test("custom welcome screen renders", async ({ page }) => {
    await page.goto("/demos/chat-slots");
    await expect(
      page.locator('[data-testid="custom-welcome-screen"]'),
    ).toBeVisible();
  });

  test("custom disclaimer renders", async ({ page }) => {
    await page.goto("/demos/chat-slots");
    await expect(
      page.locator('[data-testid="custom-disclaimer"]'),
    ).toBeVisible();
  });
});
