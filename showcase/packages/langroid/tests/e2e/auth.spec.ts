import { test, expect } from "@playwright/test";

test.describe("Auth (Langroid)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/auth");
  });

  test("banner starts unauthenticated", async ({ page }) => {
    const banner = page.locator('[data-testid="auth-banner"]').first();
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-authenticated", "false");
    await expect(
      page.locator('[data-testid="auth-authenticate-button"]'),
    ).toBeVisible();
  });

  test("clicking Authenticate flips the banner to authenticated", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="auth-authenticate-button"]')
      .first()
      .click();
    const banner = page.locator('[data-testid="auth-banner"]').first();
    await expect(banner).toHaveAttribute("data-authenticated", "true");
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toBeVisible();
  });
});
