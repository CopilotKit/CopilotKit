import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Complete)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("canonical suggestion prompt fires the feature", async ({ page }) => {
    // Headless-complete has no pill UI rendered for the chat surface — type
    // the catalog message into the existing textarea to exercise the
    // canonical aimock fixture.
    const input = page.locator("textarea").first();
    await input.fill(
      "send a sample message to populate the headless transcript",
    );
    await input.press("Enter");
    await expect(
      page.locator('[data-testid="headless-complete-messages"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
