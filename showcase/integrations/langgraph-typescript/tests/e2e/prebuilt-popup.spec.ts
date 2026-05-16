import { test, expect } from "@playwright/test";

test.describe("Pre-Built Popup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
  });

  test("page loads with heading and the popup open by default", async ({
    page,
  }) => {
    // Verbatim heading from the demo source confirms the route mounted.
    await expect(
      page.getByRole("heading", {
        name: "Popup demo — look for the floating launcher",
      }),
    ).toBeVisible();

    // defaultOpen={true} means the popup window is open on first paint. The
    // demo sets a custom placeholder via labels.chatInputPlaceholder — we
    // assert on that literal string to prove the popup rendered AND its
    // labels override took effect.
    await expect(
      page.getByPlaceholder("Ask the popup anything..."),
    ).toBeVisible();

    // The floating launcher/toggle is present on the page.
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

    // Pill sends "Say hi from the popup!" — neutral agent replies with text.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });

  test("typing a message and clicking send produces an assistant response", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Ask the popup anything...");
    await input.fill("Hello");

    // Click the send button directly — Enter-on-textarea was intermittently
    // dropping the submit on this deployment. The send-button testid is the
    // stable per-chat-input affordance that always triggers the submit
    // handler.
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    // Assistant responds — neutral agent, no tools.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });

  test("popup close button unmounts the popup; launcher re-mounts it", async ({
    page,
  }) => {
    const popup = page.locator('[data-testid="copilot-popup"]');
    await expect(popup).toBeVisible();

    // CopilotPopupView unmounts its content when closed (tracked by its
    // internal isRendered state), so the most reliable close signal is the
    // popup's own testid disappearing from the DOM.
    await page.locator('[data-testid="copilot-close-button"]').first().click();
    await expect(popup).toBeHidden({ timeout: 10000 });

    // Floating launcher remains on the page and re-mounts the popup.
    await page.locator('[data-testid="copilot-chat-toggle"]').first().click();
    await expect(popup).toBeVisible({ timeout: 10000 });

    // URL unchanged — toggling is pure client-side state.
    await expect(page).toHaveURL(/\/demos\/prebuilt-popup$/);
  });
});
