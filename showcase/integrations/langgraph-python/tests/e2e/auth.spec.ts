import { test, expect } from "@playwright/test";

/**
 * Auth demo lifecycle. The demo defaults to UNAUTHENTICATED on first
 * paint and renders SignInCard. After sign-in, <CopilotKit> mounts
 * with the bearer header attached and the chat boots. After sign-out,
 * the entire <CopilotKit> tree unmounts and SignInCard reappears.
 */
test.describe("Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/auth");
  });

  test("page loads unauthenticated with SignInCard visible", async ({
    page,
  }) => {
    await expect(
      page.locator('[data-testid="auth-sign-in-card"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="auth-sign-in-button"]'),
    ).toBeEnabled();
    await expect(page.locator('[data-testid="auth-demo-token"]')).toBeVisible();
    // Chat surface and AuthBanner only render after sign-in.
    await expect(page.locator('[data-testid="auth-banner"]')).toHaveCount(0);
    await expect(page.getByPlaceholder("Type a message")).toHaveCount(0);
  });

  test("signing in mounts the chat surface with AuthBanner", async ({
    page,
  }) => {
    await page.locator('[data-testid="auth-sign-in-button"]').click();

    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-authenticated", "true");
    await expect(page.locator('[data-testid="auth-status"]')).toContainText(
      "Signed in",
    );
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toBeEnabled();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    // SignInCard is gone once we're authenticated.
    await expect(page.locator('[data-testid="auth-sign-in-card"]')).toHaveCount(
      0,
    );
  });

  test("authenticated send produces an assistant response", async ({
    page,
  }) => {
    await page.locator('[data-testid="auth-sign-in-button"]').click();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();

    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");

    await expect(
      page.locator('[data-message-role="assistant"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test("signing out unmounts the chat tree and re-renders SignInCard", async ({
    page,
  }) => {
    await page.locator('[data-testid="auth-sign-in-button"]').click();
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toBeVisible();

    await page.locator('[data-testid="auth-sign-out-button"]').click();

    // SignInCard re-mounts; banner and chat are gone.
    await expect(page.locator('[data-testid="auth-sign-in-card"]')).toBeVisible(
      { timeout: 5000 },
    );
    await expect(page.locator('[data-testid="auth-banner"]')).toHaveCount(0);
    await expect(page.getByPlaceholder("Type a message")).toHaveCount(0);
  });

  test("signing back in re-mounts a fresh chat surface", async ({ page }) => {
    // Sign in, sign out, sign in again.
    await page.locator('[data-testid="auth-sign-in-button"]').click();
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toBeVisible();
    await page.locator('[data-testid="auth-sign-out-button"]').click();
    await expect(page.locator('[data-testid="auth-sign-in-card"]')).toBeVisible(
      { timeout: 5000 },
    );

    await page.locator('[data-testid="auth-sign-in-button"]').click();
    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(banner).toHaveAttribute("data-authenticated", "true");

    // Fresh chat surface accepts a send post-remount.
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello again");
    await input.press("Enter");
    await expect(
      page.locator('[data-message-role="assistant"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
