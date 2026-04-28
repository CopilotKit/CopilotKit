import { test, expect } from "@playwright/test";

test.describe("A2UI Fixed Schema", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/a2ui-fixed-schema");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("asking for a flight renders the fixed card", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Find me a flight from SFO to JFK on United for $289.");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60000,
    });
  });
});
