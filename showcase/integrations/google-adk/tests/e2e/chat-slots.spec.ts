import { test, expect } from "@playwright/test";

// The ADK chat-slots demo wires three slot overrides:
//   - welcomeScreen → CustomWelcomeScreen (data-testid="custom-welcome-screen")
//   - input.disclaimer → CustomDisclaimer  (data-testid="custom-disclaimer")
//   - messageView.assistantMessage → CustomAssistantMessage
//     (data-testid="custom-assistant-message")
// Each testid is the canonical signal that a slot override wired through
// end-to-end. The neutral _simple_chat agent replies with plain text on
// every turn (no frontend tools, no agent tools).
const SLOT_ASSISTANT = '[data-testid="custom-assistant-message"]';

test.describe("Chat Slots", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-slots");
  });

  test("custom welcome screen slot renders on first load", async ({ page }) => {
    // The custom welcomeScreen slot replaces the default welcome. Asserting
    // its testid catches accidental fallback to the default CopilotChat
    // welcome.
    await expect(
      page.locator('[data-testid="custom-welcome-screen"]'),
    ).toBeVisible();
  });

  test("both suggestion pills render with verbatim titles", async ({
    page,
  }) => {
    // useConfigureSuggestions registers exactly two pills with available:
    // "always". Both should be visible immediately on the welcome screen.
    await expect(
      page
        .locator('[data-testid="copilot-suggestion"]')
        .filter({ hasText: "Write a sonnet" }),
    ).toBeVisible({ timeout: 15000 });

    await expect(
      page
        .locator('[data-testid="copilot-suggestion"]')
        .filter({ hasText: "Tell me a joke" }),
    ).toBeVisible({ timeout: 15000 });
  });

  test('clicking "Tell me a joke" shows the custom assistant message slot', async ({
    page,
  }) => {
    // Click the suggestion pill — this sends "Tell me a short joke." The
    // assistant responds with text (neutral agent, no tools), and its
    // bubble must be wrapped in the CustomAssistantMessage container.
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Tell me a joke" })
      .first()
      .click();

    // The MessageView.AssistantMessage slot wraps every assistant bubble;
    // its presence proves the slot override took effect rather than the
    // default CopilotChatAssistantMessage rendering bare.
    await expect(page.locator(SLOT_ASSISTANT).first()).toBeVisible({
      timeout: 45000,
    });
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
    await expect(page.locator(SLOT_ASSISTANT).first()).toBeVisible({
      timeout: 45000,
    });

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
    await expect(page.locator(SLOT_ASSISTANT).first()).toBeVisible({
      timeout: 45000,
    });

    // Turn 2 — the slot should wrap every assistant turn, not just the first.
    await input.fill("Say something short");
    await sendBtn().click();

    // Expect at least two custom-wrapped assistant messages.
    await expect
      .poll(async () => await page.locator(SLOT_ASSISTANT).count(), {
        timeout: 45000,
      })
      .toBeGreaterThanOrEqual(2);
  });
});
