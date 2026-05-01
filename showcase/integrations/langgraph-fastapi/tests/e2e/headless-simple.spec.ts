import { test, expect } from "@playwright/test";

test.describe("Headless Simple", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("canonical suggestion prompt fires the feature", async ({ page }) => {
    // Headless simple uses a textarea — type the catalog message instead of clicking a pill.
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });
    await textarea.fill("show a small card body about hummingbirds");
    await textarea.press("Enter");
    await expect(
      page.locator('[data-message-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
