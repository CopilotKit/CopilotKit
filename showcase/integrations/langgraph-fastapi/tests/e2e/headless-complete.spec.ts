import { test, expect } from "@playwright/test";

test.describe("Headless Complete", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("canonical suggestion prompt fires the feature", async ({ page }) => {
    // Headless complete uses a textarea — type the catalog message instead of clicking a pill.
    const textarea = page.getByPlaceholder("Type a message");
    await expect(textarea).toBeVisible({ timeout: 30_000 });
    await textarea.fill(
      "send a sample message to populate the headless transcript",
    );
    await textarea.press("Enter");
    await expect(
      page.locator('[data-testid="headless-complete-messages"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
