import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/auth");
  });

  test("unauthenticated banner + Authenticate button render on load", async ({
    page,
  }) => {
    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-authenticated", "false");
    await expect(
      page.locator('[data-testid="auth-authenticate-button"]'),
    ).toBeVisible();
  });

  test("authenticate flips the banner to emerald/authenticated", async ({
    page,
  }) => {
    await page.locator('[data-testid="auth-authenticate-button"]').click();
    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toHaveAttribute("data-authenticated", "true");
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toBeVisible();
  });

  test("unauthenticated send surfaces a 401 error banner", async ({ page }) => {
    const input = page.getByPlaceholder(/type a message/i);
    await input.fill("Hello");
    await input.press("Enter");

    await expect(page.locator('[data-testid="auth-demo-error"]')).toBeVisible({
      timeout: 45000,
    });
  });
});
