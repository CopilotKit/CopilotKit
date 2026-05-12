import { test, expect } from "@playwright/test";

/**
 * Auth demo lifecycle. The demo defaults to UNAUTHENTICATED on first
 * paint and renders SignInCard. After sign-in, <CopilotKit> mounts with
 * the bearer header attached and the chat boots. After sign-out the
 * chat STAYS MOUNTED (now with no Authorization header) so the user can
 * actually watch the runtime reject an unauthenticated send — that is
 * the whole point of the demo. The AuthBanner flips between green
 * (authenticated) and amber (signed-out) variants. Only a full page
 * reload resets to the SignInCard first-paint state.
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
    // Chat surface and AuthBanner only render after the first sign-in.
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
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test("signing out flips the banner amber and keeps the chat surface mounted", async ({
    page,
  }) => {
    await page.locator('[data-testid="auth-sign-in-button"]').click();
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toBeVisible();

    await page.locator('[data-testid="auth-sign-out-button"]').click();

    // Banner flips to the amber variant. SignInCard does NOT come back —
    // the demo would never get to showcase the rejection if it did.
    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-authenticated", "false");
    await expect(page.locator('[data-testid="auth-status"]')).toContainText(
      "Signed out",
    );
    await expect(
      page.locator('[data-testid="auth-authenticate-button"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-testid="auth-sign-in-card"]')).toHaveCount(
      0,
    );
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("unauthenticated send surfaces a 401 error without crashing the page", async ({
    page,
  }) => {
    await page.locator('[data-testid="auth-sign-in-button"]').click();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await page.locator('[data-testid="auth-sign-out-button"]').click();
    await expect(
      page.locator('[data-testid="auth-authenticate-button"]'),
    ).toBeVisible();

    // After sign-out, the next send must surface the rejection — not
    // produce an assistant response and not white-screen the page.
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello again");
    await input.press("Enter");

    const errorSurface = page.locator('[data-testid="auth-demo-error"]');
    await expect(errorSurface).toBeVisible({ timeout: 15000 });
    // Page chrome stays visible — no white-screen.
    await expect(page.locator('[data-testid="auth-banner"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]'),
    ).toHaveCount(0);
  });

  test("re-signing in from the amber banner clears the error and resumes chat", async ({
    page,
  }) => {
    await page.locator('[data-testid="auth-sign-in-button"]').click();
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toBeVisible();
    await page.locator('[data-testid="auth-sign-out-button"]').click();
    await expect(
      page.locator('[data-testid="auth-authenticate-button"]'),
    ).toBeVisible();

    await page.locator('[data-testid="auth-authenticate-button"]').click();
    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toHaveAttribute("data-authenticated", "true", {
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="auth-demo-error"]')).toHaveCount(
      0,
    );

    // Chat is responsive again.
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello again");
    await input.press("Enter");
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
