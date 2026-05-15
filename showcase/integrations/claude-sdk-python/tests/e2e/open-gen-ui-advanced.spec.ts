import { test, expect } from "@playwright/test";

test.describe("Open-Ended Generative UI (Advanced)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/open-gen-ui-advanced");
  });

  test("chat input is reachable", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
