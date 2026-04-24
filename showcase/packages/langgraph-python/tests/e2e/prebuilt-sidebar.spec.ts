import { test, expect } from "@playwright/test";

test.describe("Pre-Built Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-sidebar");
  });

  test("page loads with heading, main content, and sidebar open by default", async ({
    page,
  }) => {
    // Main content heading is verbatim from the demo source and confirms the
    // route mounted the expected page.
    await expect(
      page.getByRole("heading", { name: "Sidebar demo — click the launcher" }),
    ).toBeVisible();

    // defaultOpen={true} means the sidebar's chat input is mounted and
    // visible on first paint.
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();

    // The sidebar ships its own toggle button with a dedicated testid.
    await expect(
      page.locator('[data-testid="copilot-chat-toggle"]').first(),
    ).toBeVisible();
  });

  test('"Say hi" suggestion pill renders and sends on click', async ({
    page,
  }) => {
    // useConfigureSuggestions registers a single "Say hi" pill with
    // available: "always", so it should render inside the sidebar on load.
    const sayHiPill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Say hi" })
      .first();
    await expect(sayHiPill).toBeVisible({ timeout: 15000 });

    await sayHiPill.click();

    // The pill sends "Say hi!". We assert on the assistant message testid
    // rather than response text since this demo has no frontend tools — the
    // round-trip signal is simply "an assistant bubble appeared".
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });

  test("typing a message and clicking send produces an assistant response", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");

    // Click the send button directly — using Enter on the textarea was
    // intermittently dropping the submit on this deployment (the welcome
    // screen stayed mounted with the text still in the box), so we use the
    // stable send-button testid the v2 CopilotChatInput exposes.
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    // Assistant responds — the neutral agent just chats, no tools.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });

  test("sidebar close toggles aria-hidden and the launcher re-opens it", async ({
    page,
  }) => {
    const sidebar = page.locator('[data-testid="copilot-sidebar"]');

    // Opens with aria-hidden="false" because of defaultOpen={true}.
    await expect(sidebar).toHaveAttribute("aria-hidden", "false");

    // CopilotSidebar renders its own close button in the modal header.
    // Clicking the external toggle doesn't work while the sidebar is open
    // (it intercepts pointer events on this viewport width), so we close
    // from within.
    await page.locator('[data-testid="copilot-close-button"]').first().click();

    // The sidebar slides out via CSS transform but stays mounted. The
    // authoritative open/closed signal is the aria-hidden attribute the
    // component writes based on its isModalOpen state.
    await expect(sidebar).toHaveAttribute("aria-hidden", "true", {
      timeout: 10000,
    });

    // Re-open via the floating toggle button, now uncovered.
    await page.locator('[data-testid="copilot-chat-toggle"]').first().click();
    await expect(sidebar).toHaveAttribute("aria-hidden", "false", {
      timeout: 10000,
    });

    // URL unchanged — toggling is pure client-side state.
    await expect(page).toHaveURL(/\/demos\/prebuilt-sidebar$/);
  });
});
