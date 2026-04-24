import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("auth banner renders in unauthenticated state", async ({ page }) => {
    await page.goto("/demos/auth");
    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-authenticated", "false");
    await expect(
      page.locator('[data-testid="auth-authenticate-button"]'),
    ).toBeVisible();
  });

  test("authenticate button flips the banner", async ({ page }) => {
    await page.goto("/demos/auth");
    await page.locator('[data-testid="auth-authenticate-button"]').click();
    await expect(page.locator('[data-testid="auth-banner"]')).toHaveAttribute(
      "data-authenticated",
      "true",
    );
  });
});
