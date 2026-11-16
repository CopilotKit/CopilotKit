import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// The demo sets this placeholder with labels.chatInputPlaceholder. When it
// shows, the popup rendered and its labels override took effect.
const POPUP_PLACEHOLDER = "Ask the popup anything...";

function firstAssistantMessage(page: Page) {
  return page.locator('[data-testid="copilot-assistant-message"]').first();
}

describeDemo("prebuilt-popup", "Pre-Built Popup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("prebuilt-popup"));
  });

  test("page loads with heading and the popup open by default", async ({
    page,
  }) => {
    // The heading is verbatim from the demo source, so it confirms that the
    // route mounted.
    await expect(
      page.getByRole("heading", { name: "Popup demo" }),
    ).toBeVisible();

    // defaultOpen={true} means that the popup window is open on first paint.
    await expect(page.getByPlaceholder(POPUP_PLACEHOLDER)).toBeVisible();

    // The floating launcher is on the page.
    await expect(
      page.locator('[data-testid="copilot-chat-toggle"]').first(),
    ).toBeVisible();
  });

  test('"Say hi" suggestion pill renders and produces an assistant response', async ({
    page,
  }) => {
    // useConfigureSuggestions registers "Say hi" with available: "always".
    const sayHiPill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Say hi" })
      .first();
    await expect(sayHiPill).toBeVisible({ timeout: 15000 });

    await sayHiPill.click();

    // The pill sends "Say hi from the popup!", and the agent replies with text.
    await expect(firstAssistantMessage(page)).toBeVisible({ timeout: 45000 });
  });

  test("typing a message and clicking send produces an assistant response", async ({
    page,
  }) => {
    const input = page.getByPlaceholder(POPUP_PLACEHOLDER);
    await input.fill("Hello");

    // Click the send button. Enter in the textarea sometimes dropped the
    // submit, and the send-button testid always triggers the submit handler.
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    await expect(firstAssistantMessage(page)).toBeVisible({ timeout: 45000 });
  });

  test("popup close button unmounts the popup; launcher re-mounts it", async ({
    page,
  }) => {
    const popup = page.locator('[data-testid="copilot-popup"]');
    await expect(popup).toBeVisible();

    // CopilotPopupView unmounts its content when it closes, so the popup
    // testid leaving the DOM is the close signal. On localhost, the dev-only
    // <cpk-web-inspector> overlay catches the pointer clicks of Playwright.
    // A DOM click goes around the overlay (the same pattern as clickByJs in
    // the harness probes, _genuine-shared.ts).
    await page.evaluate(() => {
      const closeButton = document.querySelector(
        '[data-testid="copilot-close-button"]',
      );
      if (closeButton instanceof HTMLElement) closeButton.click();
    });
    await expect(popup).toBeHidden({ timeout: 10000 });

    // The launcher stays on the page and mounts the popup again.
    await page.locator('[data-testid="copilot-chat-toggle"]').first().click();
    await expect(popup).toBeVisible({ timeout: 10000 });

    // The URL does not change: opening and closing is client-side state.
    await expect(page).toHaveURL(demoPath("prebuilt-popup"));
  });
});
