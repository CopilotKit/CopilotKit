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
    // No error surface on first load.
    await expect(page.locator('[data-testid="auth-demo-error"]')).toHaveCount(
      0,
    );
  });

  test("authenticated send produces an assistant response", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
    // No error surface should appear while authenticated.
    await expect(page.locator('[data-testid="auth-demo-error"]')).toHaveCount(
      0,
    );
  });

  test("signing out flips banner and surfaces 401 on next send without crashing", async ({
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
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toHaveCount(0);

    // Next send should 401 and show the error surface — no white-screen.
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello again");
    await input.press("Enter");
    const errorSurface = page.locator('[data-testid="auth-demo-error"]');
    await expect(errorSurface).toBeVisible({ timeout: 15000 });
    await expect(errorSurface).toContainText(/401|unauthor/i);

    // Banner must still be rendered — a crash would unmount it.
    await expect(banner).toBeVisible();
  });

  test("signing back in clears the error and re-enables successful sends", async ({
    page,
  }) => {
    // Sign out, fire a failing send to populate the error surface.
    await page.locator('[data-testid="auth-sign-out-button"]').click();
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");
    const errorSurface = page.locator('[data-testid="auth-demo-error"]');
    await expect(errorSurface).toBeVisible({ timeout: 15000 });

    // Sign back in — error clears, banner flips, chat works.
    await page.locator('[data-testid="auth-authenticate-button"]').click();
    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toHaveAttribute("data-authenticated", "true", {
      timeout: 2000,
    });
    await expect(errorSurface).toHaveCount(0);

    await input.fill("Hello again");
    await input.press("Enter");
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });
});
