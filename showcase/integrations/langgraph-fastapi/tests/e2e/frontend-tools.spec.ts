import { test, expect } from "@playwright/test";

test.describe("Frontend Tools", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools");
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Switch theme/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="background-container"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
