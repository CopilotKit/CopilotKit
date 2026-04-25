import { test, expect } from "@playwright/test";

test.describe("Chat Slots", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-slots");
  });

  test("custom welcome screen slot renders", async ({ page }) => {
    await expect(
      page.locator('[data-testid="custom-welcome-screen"]'),
    ).toBeVisible();
    await expect(page.getByText("Welcome to the Slots demo")).toBeVisible();
  });

  test("page shows suggestion pills", async ({ page }) => {
    await expect(page.getByText("Write a sonnet").first()).toBeVisible();
    await expect(page.getByText("Tell me a joke").first()).toBeVisible();
  });
});
