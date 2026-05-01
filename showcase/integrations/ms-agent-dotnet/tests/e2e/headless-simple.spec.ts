import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Simple)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("canonical suggestion prompt fires the feature", async ({ page }) => {
    const input = page.locator("textarea").first();
    await input.fill("show a small card body about hummingbirds");
    await input.press("Enter");
    await expect(
      page.locator('[data-message-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
