import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/auth");
  });

  test("banner starts authenticated by default", async ({ page }) => {
    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-authenticated", "true");
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toBeVisible();
  });

  test("sign-out transitions the banner to unauthenticated", async ({
    page,
  }) => {
    await page.locator('[data-testid="auth-sign-out-button"]').click();
    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toHaveAttribute("data-authenticated", "false");
    await expect(
      page.locator('[data-testid="auth-authenticate-button"]'),
    ).toBeVisible();
  });
});
