import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

/**
 * The auth demo's lifecycle. The first paint is signed out and shows the
 * sign-in card. Signing in mounts <CopilotKit> with the bearer header, and
 * the chat starts. Signing out keeps the chat on the page, now without the
 * `Authorization` header, so the user can watch the runtime reject a send:
 * that is the point of the demo. The banner switches between green (signed
 * in) and amber (signed out). Only a full reload brings the sign-in card
 * back.
 */

const BANNER = '[data-testid="auth-banner"]';
const STATUS = '[data-testid="auth-status"]';
const SIGN_IN_CARD = '[data-testid="auth-sign-in-card"]';
const SIGN_IN_BUTTON = '[data-testid="auth-sign-in-button"]';
const SIGN_OUT_BUTTON = '[data-testid="auth-sign-out-button"]';
const AUTHENTICATE_BUTTON = '[data-testid="auth-authenticate-button"]';
const ERROR_SURFACE = '[data-testid="auth-demo-error"]';
const ASSISTANT_MESSAGE = '[data-testid="copilot-assistant-message"]';

async function signInFromCard(page: Page) {
  await page.locator(SIGN_IN_BUTTON).click();
  await expect(page.locator(SIGN_OUT_BUTTON)).toBeVisible();
}

async function signOut(page: Page) {
  await page.locator(SIGN_OUT_BUTTON).click();
  await expect(page.locator(AUTHENTICATE_BUTTON)).toBeVisible();
}

async function send(page: Page, text: string) {
  const input = page.getByPlaceholder("Type a message");
  await input.fill(text);
  await input.press("Enter");
}

describeDemo("auth", "Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("auth"));
  });

  test("page loads unauthenticated with SignInCard visible", async ({
    page,
  }) => {
    await expect(page.locator(SIGN_IN_CARD)).toBeVisible();
    await expect(page.locator(SIGN_IN_BUTTON)).toBeEnabled();
    await expect(page.locator('[data-testid="auth-demo-token"]')).toBeVisible();
    // The chat and the banner render only after the first sign-in.
    await expect(page.locator(BANNER)).toHaveCount(0);
    await expect(page.getByPlaceholder("Type a message")).toHaveCount(0);
  });

  test("signing in mounts the chat surface with AuthBanner", async ({
    page,
  }) => {
    await page.locator(SIGN_IN_BUTTON).click();

    const banner = page.locator(BANNER);
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-authenticated", "true");
    await expect(page.locator(STATUS)).toContainText("Signed in");
    await expect(page.locator(SIGN_OUT_BUTTON)).toBeEnabled();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    // The sign-in card is gone once the user is signed in.
    await expect(page.locator(SIGN_IN_CARD)).toHaveCount(0);
  });

  test("authenticated send produces an assistant response", async ({
    page,
  }) => {
    await signInFromCard(page);
    await send(page, "Say hello in one short sentence");

    await expect(page.locator(ASSISTANT_MESSAGE).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("signing out flips the banner amber and keeps the chat surface mounted", async ({
    page,
  }) => {
    await signInFromCard(page);
    await page.locator(SIGN_OUT_BUTTON).click();

    // The banner turns amber. The sign-in card does NOT come back: the demo
    // needs the chat on the page to show the rejection.
    const banner = page.locator(BANNER);
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-authenticated", "false");
    await expect(page.locator(STATUS)).toContainText("Signed out");
    await expect(page.locator(AUTHENTICATE_BUTTON)).toBeVisible();
    await expect(page.locator(SIGN_OUT_BUTTON)).toHaveCount(0);
    await expect(page.locator(SIGN_IN_CARD)).toHaveCount(0);
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("unauthenticated send surfaces a 401 error without crashing the page", async ({
    page,
  }) => {
    await signInFromCard(page);
    await signOut(page);

    // After the sign-out, the next send must show the rejection: no
    // assistant response, and no blank page.
    await send(page, "Tell me a one-line joke");

    await expect(page.locator(ERROR_SURFACE)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(BANNER)).toBeVisible();
    await expect(page.locator(ASSISTANT_MESSAGE)).toHaveCount(0);
  });

  test("re-signing in from the amber banner clears the error and resumes chat", async ({
    page,
  }) => {
    await signInFromCard(page);
    await signOut(page);

    await page.locator(AUTHENTICATE_BUTTON).click();
    await expect(page.locator(BANNER)).toHaveAttribute(
      "data-authenticated",
      "true",
      { timeout: 5_000 },
    );
    await expect(page.locator(ERROR_SURFACE)).toHaveCount(0);

    // The chat answers again.
    await send(page, "Give me a fun fact");
    await expect(page.locator(ASSISTANT_MESSAGE).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
