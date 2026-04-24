import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/auth");
  });

  test("page loads authenticated with green banner + Sign out button", async ({
    page,
  }) => {
    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-authenticated", "true");
    await expect(page.locator('[data-testid="auth-status"]')).toContainText(
      "Signed in",
    );
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toBeEnabled();
    await expect(
      page.locator('[data-testid="auth-authenticate-button"]'),
    ).toHaveCount(0);
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(page.locator('[data-testid="auth-demo-error"]')).toHaveCount(
      0,
    );
  });

  test("signing out flips banner and keeps the page mounted", async ({
    page,
  }) => {
    const banner = page.locator('[data-testid="auth-banner"]');
    await page.locator('[data-testid="auth-sign-out-button"]').click();
    await expect(banner).toHaveAttribute("data-authenticated", "false", {
      timeout: 2000,
    });
    await expect(page.locator('[data-testid="auth-status"]')).toContainText(
      "Signed out",
    );
    await expect(
      page.locator('[data-testid="auth-authenticate-button"]'),
    ).toBeVisible();
    // Banner must still be mounted — a crash would unmount it.
    await expect(banner).toBeVisible();
  });
});
