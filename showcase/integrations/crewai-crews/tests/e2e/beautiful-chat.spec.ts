import { test, expect } from "@playwright/test";

test.describe("Beautiful Chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/beautiful-chat");
  });

  test("demo-root renders", async ({ page }) => {
    await expect(
      page.locator('[data-testid="beautiful-chat-root"]'),
    ).toBeVisible();
  });
});
