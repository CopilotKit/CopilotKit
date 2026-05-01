import { test, expect } from "@playwright/test";

test.describe("Auth", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/auth");
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Auth check/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="auth-banner"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
