import { test, expect } from "@playwright/test";

test.describe("Chat Slots", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-slots");
  });

  test("custom welcome screen slot renders on first load", async ({ page }) => {
    // The custom welcomeScreen slot replaces the default welcome. Its testid
    // + verbatim heading together prove the slot override wired through.
    const welcome = page.locator('[data-testid="custom-welcome-screen"]');
    await expect(welcome).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Welcome to the Slots demo" }),
    ).toBeVisible();

    // The gradient card exposes its own literal label — "Custom Slot" —
    // which makes accidental fallback to the default welcome easy to detect.
    await expect(welcome.getByText("Custom Slot")).toBeVisible();
  });

  test("the canonical suggestion pill renders with its verbatim title", async ({
    page,
  }) => {
    // Demo-specific suggestion set was collapsed to the single canonical
    // pill (see showcase/aimock/_canonical-catalog.json) so the e2e fixture
    // remains substring-disjoint with every other demo.
    await expect(
      page
        .locator('[data-testid="copilot-suggestion"]')
        .filter({ hasText: "Slot wiring" }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("clicking the canonical pill shows the custom assistant message slot", async ({
    page,
  }) => {
    // Click the canonical suggestion pill — the assistant will respond
    // with text (neutral agent, no tools), and its bubble must be wrapped
    // in the custom slot container.
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Slot wiring" })
      .first()
      .click();

    // Custom assistant-message slot is the defining slot-override signal:
    // every assistant bubble flows through CustomAssistantMessage, which
    // wraps the default in a tinted card with this testid.
    const customMsg = page
      .locator('[data-testid="custom-assistant-message"]')
      .first();
    await expect(customMsg).toBeVisible({ timeout: 45000 });

    // The "slot" badge is absolutely-positioned inside the custom wrapper —
    // its presence proves our wrapper rendered rather than the default
    // CopilotChatAssistantMessage bare.
    await expect(customMsg.getByText("slot", { exact: true })).toBeVisible();
  });

  test("custom disclaimer slot renders after the first user message", async ({
    page,
  }) => {
    // Type and send via the send button — Enter-on-textarea was intermittently
    // dropping the submit on this deployment. We assert the disclaimer +
    // custom assistant wrapper appear once we transition out of the welcome
    // state.
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    // Assistant replies and is wrapped in the custom slot.
    await expect(
      page.locator('[data-testid="custom-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });

    // The custom disclaimer slot lives below the input on the post-welcome
    // chat view. The welcome-screen state hides it; once the assistant
    // responds the welcome is gone and the disclaimer should be visible.
    await expect(page.locator('[data-testid="custom-disclaimer"]')).toBeVisible(
      { timeout: 10000 },
    );
  });

  test("second assistant turn is also wrapped in the custom slot", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    const sendBtn = () =>
      page.locator('[data-testid="copilot-send-button"]').first();

    // Turn 1
    await input.fill("Hi");
    await sendBtn().click();
    await expect(
      page.locator('[data-testid="custom-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });

    // Turn 2 — the slot should wrap every assistant turn, not just the first.
    await input.fill("Say something short");
    await sendBtn().click();

    // Expect at least two custom-wrapped assistant messages.
    await expect
      .poll(
        async () =>
          await page
            .locator('[data-testid="custom-assistant-message"]')
            .count(),
        { timeout: 45000 },
      )
      .toBeGreaterThanOrEqual(2);
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Slot wiring/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(page.locator("[data-testid=\"custom-assistant-message\"]").first()).toBeVisible({ timeout: 60_000 });
  });
});
