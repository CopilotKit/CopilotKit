import { test, expect } from "@playwright/test";

// Behavioral e2e for the auth demo (OpenClaw), run against aimock. The gateway
// injects X-AIMock-Context: openclaw, so the authenticated prompts below match
// the fixtures in showcase/aimock/d4/openclaw/chat.json.
//
// Auth demo lifecycle. The demo defaults to UNAUTHENTICATED on first paint and
// renders SignInCard (no <CopilotKit>, so the transport 401 can't crash the
// initial /info handshake). After sign-in, <CopilotKit> mounts pointed at
// /api/copilotkit-auth (agent "auth-demo") with the `Authorization: Bearer
// <DEMO_TOKEN>` header attached, and the chat boots. After sign-out the chat
// STAYS MOUNTED (now with no Authorization header) so the user can watch the
// runtime's `onRequest` gate reject an unauthenticated send with a 401 — that
// is the whole point of the demo. The AuthBanner flips between the emerald
// (authenticated) and amber (signed-out) variants via data-authenticated. Only
// a full page reload resets to the SignInCard first-paint state.
test.describe("Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/auth");
  });

  test("page loads unauthenticated with SignInCard visible", async ({
    page,
  }) => {
    await expect(
      page.locator('[data-testid="auth-sign-in-card"]'),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.locator('[data-testid="auth-sign-in-button"]'),
    ).toBeEnabled();
    await expect(page.locator('[data-testid="auth-demo-token"]')).toBeVisible();
    // Chat surface and AuthBanner only render after the first sign-in.
    await expect(page.locator('[data-testid="auth-banner"]')).toHaveCount(0);
    await expect(page.getByPlaceholder("Type a message")).toHaveCount(0);
  });

  test("signing in mounts the chat surface with the emerald AuthBanner", async ({
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

  test("authenticated send produces the fixture-driven assistant response", async ({
    page,
  }) => {
    await page.locator('[data-testid="auth-sign-in-button"]').click();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();

    const input = page.getByPlaceholder("Type a message");
    await input.fill("Confirm my session is authenticated.");
    await input.press("Enter");

    // The assistant message renders and contains the fixture-specific text,
    // proving the authenticated request reached the runtime and the aimock
    // fixture drove the run.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByText(/authenticated and connected/i).last(),
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

    // Banner flips to the amber variant. SignInCard does NOT come back — the
    // demo would never get to showcase the rejection if it did.
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

    // After sign-out the Authorization header is gone, so the runtime's
    // `onRequest` gate rejects the next send with a 401. The demo must surface
    // that rejection — not produce an assistant response and not white-screen.
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Confirm my session is authenticated.");
    await input.press("Enter");

    const errorSurface = page.locator('[data-testid="auth-demo-error"]');
    await expect(errorSurface).toBeVisible({ timeout: 15000 });
    // Page chrome stays visible — no white-screen.
    await expect(page.locator('[data-testid="auth-banner"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]'),
    ).toHaveCount(0);
  });

  test("re-authenticating from the amber banner clears the error and resumes chat", async ({
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

    // Trigger a rejection first so there's an error to clear.
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Confirm my session is authenticated.");
    await input.press("Enter");
    await expect(page.locator('[data-testid="auth-demo-error"]')).toBeVisible({
      timeout: 15000,
    });

    await page.locator('[data-testid="auth-authenticate-button"]').click();
    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toHaveAttribute("data-authenticated", "true", {
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="auth-demo-error"]')).toHaveCount(
      0,
    );

    // Chat is responsive again — a fresh authenticated send is fixture-driven.
    await input.fill("Give me one fun fact about secure sessions.");
    await input.press("Enter");
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/session cookie/i).last()).toBeVisible({
      timeout: 30000,
    });
  });
});
