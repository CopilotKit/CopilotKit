import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/auth");
  });

  test("page loads unauthenticated with amber banner + Authenticate button", async ({
    page,
  }) => {
    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-authenticated", "false");
    await expect(page.locator('[data-testid="auth-status"]')).toContainText(
      "Not authenticated",
    );
    await expect(
      page.locator('[data-testid="auth-authenticate-button"]'),
    ).toBeEnabled();
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toHaveCount(0);
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    // No error surface on first load.
    await expect(
      page.locator('[data-testid="auth-demo-error"]'),
    ).toHaveCount(0);
  });

  test("unauthenticated send surfaces a 401 error via auth-demo-error", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");

    // Page-level error surface is the stable contract; <CopilotChat />
    // error rendering varies by state.
    const errorSurface = page.locator('[data-testid="auth-demo-error"]');
    await expect(errorSurface).toBeVisible({ timeout: 15000 });
    await expect(errorSurface).toContainText(/401|unauthor/i);

    // No assistant message should have landed.
    await expect(page.locator('[data-role="assistant"]')).toHaveCount(0);
  });

  test("clicking Authenticate flips banner and enables successful sends", async ({
    page,
  }) => {
    const banner = page.locator('[data-testid="auth-banner"]');
    await page.locator('[data-testid="auth-authenticate-button"]').click();

    await expect(banner).toHaveAttribute("data-authenticated", "true", {
      timeout: 2000,
    });
    await expect(page.locator('[data-testid="auth-status"]')).toContainText(
      "Authenticated",
    );
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="auth-authenticate-button"]'),
    ).toHaveCount(0);

    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");

    await expect(
      page.locator('[data-role="assistant"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test("signing out reverts to the 401 path on the next send", async ({
    page,
  }) => {
    // Authenticate first.
    await page.locator('[data-testid="auth-authenticate-button"]').click();
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");
    await expect(
      page.locator('[data-role="assistant"]').first(),
    ).toBeVisible({ timeout: 30000 });

    // Sign out.
    await page.locator('[data-testid="auth-sign-out-button"]').click();
    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toHaveAttribute("data-authenticated", "false", {
      timeout: 2000,
    });

    // Next send should 401 and show the error surface.
    await input.fill("Hello again");
    await input.press("Enter");
    const errorSurface = page.locator('[data-testid="auth-demo-error"]');
    await expect(errorSurface).toBeVisible({ timeout: 15000 });
    await expect(errorSurface).toContainText(/401|unauthor/i);
  });
});
