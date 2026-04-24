import { test, expect } from "@playwright/test";

test.describe("Chat Slots", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-slots");
  });

  test("custom welcome screen renders", async ({ page }) => {
    await expect(
      page.locator('[data-testid="custom-welcome-screen"]'),
    ).toBeVisible({ timeout: 10000 });
  });

  test("custom disclaimer renders", async ({ page }) => {
    await expect(
      page.locator('[data-testid="custom-disclaimer"]'),
    ).toBeVisible({ timeout: 10000 });
  });
});
