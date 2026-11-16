import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

function firstAssistantMessage(page: Page) {
  return page.locator('[data-testid="copilot-assistant-message"]').first();
}

describeDemo("prebuilt-sidebar", "Pre-Built Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("prebuilt-sidebar"));
  });

  test("page loads with heading, main content, and sidebar open by default", async ({
    page,
  }) => {
    // The main content heading is verbatim from the demo source, so it
    // confirms that the route mounted the expected page.
    await expect(
      page.getByRole("heading", { name: "Sidebar demo" }),
    ).toBeVisible();

    // defaultOpen={true} means that the chat input of the sidebar is mounted
    // and visible on first paint.
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();

    // The sidebar has its own toggle button with a dedicated testid.
    await expect(
      page.locator('[data-testid="copilot-chat-toggle"]').first(),
    ).toBeVisible();
  });

  test('"Say hi" suggestion pill renders and sends on click', async ({
    page,
  }) => {
    // useConfigureSuggestions registers "Say hi" with available: "always", so
    // it renders inside the sidebar on load.
    const sayHiPill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Say hi" })
      .first();
    await expect(sayHiPill).toBeVisible({ timeout: 15000 });

    await sayHiPill.click();

    // The pill sends "Say hi!". This demo has no frontend tools, so the
    // round-trip signal is an assistant message, not its text.
    await expect(firstAssistantMessage(page)).toBeVisible({ timeout: 45000 });
  });

  test("typing a message and clicking send produces an assistant response", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");

    // Click the send button. Enter in the textarea sometimes dropped the
    // submit (the welcome screen stayed, with the text still in the box).
    // The send-button testid of the v2 CopilotChatInput always submits.
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    await expect(firstAssistantMessage(page)).toBeVisible({ timeout: 45000 });
  });

  test("sidebar close toggles aria-hidden and the launcher re-opens it", async ({
    page,
  }) => {
    const sidebar = page.locator('[data-testid="copilot-sidebar"]');

    // defaultOpen={true} opens it with aria-hidden="false".
    await expect(sidebar).toHaveAttribute("aria-hidden", "false");

    // CopilotSidebar has its own close button in the modal header. While the
    // sidebar is open, it covers the external toggle at this viewport width,
    // so the test closes it from inside. On localhost, the dev-only
    // <cpk-web-inspector> overlay catches the pointer clicks of Playwright.
    // A DOM click goes around the overlay (the same pattern as clickByJs in
    // the harness probes, _genuine-shared.ts).
    await page.evaluate(() => {
      const closeButton = document.querySelector(
        '[data-testid="copilot-close-button"]',
      );
      if (closeButton instanceof HTMLElement) closeButton.click();
    });

    // The sidebar slides out with a CSS transform but stays mounted. The
    // aria-hidden attribute, which follows its isModalOpen state, is the
    // open or closed signal.
    await expect(sidebar).toHaveAttribute("aria-hidden", "true", {
      timeout: 10000,
    });

    // Open it again with the floating toggle button, which is now uncovered.
    await page.locator('[data-testid="copilot-chat-toggle"]').first().click();
    await expect(sidebar).toHaveAttribute("aria-hidden", "false", {
      timeout: 10000,
    });

    // The URL does not change: opening and closing is client-side state.
    await expect(page).toHaveURL(demoPath("prebuilt-sidebar"));
  });
});
