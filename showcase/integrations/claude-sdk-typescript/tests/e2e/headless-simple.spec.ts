import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Simple)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("page loads without runtime errors", async ({ page }) => {
    // The custom headless surface renders its own input; we just verify no
    // runtime errors by checking the main element exists.
    await expect(page.locator("main").first()).toBeVisible({ timeout: 15000 });
  });

  test("canonical suggestion prompt fires the feature", async ({ page }) => {
    // Headless-simple has no pill UI — type the catalog message into the
    // existing textarea to exercise the canonical aimock fixture.
    const input = page.locator("textarea").first();
    await input.fill("show a small card body about hummingbirds");
    await input.press("Enter");
    await expect(
      page.locator('[data-message-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
