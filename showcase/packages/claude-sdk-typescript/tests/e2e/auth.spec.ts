import { test, expect } from "@playwright/test";

test.describe("Auth demo", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/auth");
  });

  test("starts signed in and can toggle to signed out", async ({ page }) => {
    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-authenticated", "true");

    await page.locator('[data-testid="auth-sign-out-button"]').click();
    await expect(banner).toHaveAttribute("data-authenticated", "false");
    await expect(
      page.locator('[data-testid="auth-authenticate-button"]'),
    ).toBeVisible();
  });
});
