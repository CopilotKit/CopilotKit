import { test, expect } from "@playwright/test";

// Each custom slot wraps the default in a `SlotMarker` that emits
// `data-slot-label="<slot-path>"`. That attribute is the canonical
// signal that a slot override wired through end-to-end (the welcome
// screen + disclaimer also expose dedicated `data-testid` attributes
// for ergonomics).
const SLOT_LABEL_ASSISTANT = '[data-slot-label="MessageView.AssistantMessage"]';

test.describe("Chat Slots", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-slots");
  });

  test("custom welcome screen slot renders on first load", async ({ page }) => {
    // The custom welcomeScreen slot replaces the default welcome. Both its
    // own testid and the nested welcomeMessage sub-slot's testid prove the
    // override wired through end-to-end. Asserting both catches accidental
    // fallback to the default CopilotChat welcome.
    const welcome = page.locator('[data-testid="custom-welcome-screen"]');
    await expect(welcome).toBeVisible();

    await expect(
      welcome.locator('[data-testid="custom-welcome-message"]'),
    ).toBeVisible();
  });

  test("both suggestion pills render with verbatim titles", async ({
    page,
  }) => {
    // useConfigureSuggestions registers exactly two pills with available: "always".
    // Both should be visible immediately on the welcome screen.
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
    // bubble must be wrapped in the CustomAssistantMessage SlotMarker.
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Tell me a joke" })
      .first()
      .click();

    // The MessageView.AssistantMessage slot-marker wraps every assistant
    // bubble; its presence proves the slot override took effect rather
    // than the default CopilotChatAssistantMessage rendering bare.
    await expect(page.locator(SLOT_LABEL_ASSISTANT).first()).toBeVisible({
      timeout: 45000,
    });
  });

  test("custom disclaimer slot renders after the first user message", async ({
    page,
  }) => {
    // Type and send via the send button — Enter-on-textarea was intermittently
    // dropping the submit on this deployment. We assert the disclaimer +
    // custom assistant wrapper appear once we transition out of the welcome
    // state. Use exact aimock fixture messages to ensure deterministic responses.
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Say hello in one short sentence");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    // Assistant replies and is wrapped in the custom slot.
    await expect(page.locator(SLOT_LABEL_ASSISTANT).first()).toBeVisible({
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

    // Turn 1 — use exact aimock fixture messages for deterministic responses.
    await input.fill("Say hello in one short sentence");
    await sendBtn().click();
    await expect(page.locator(SLOT_LABEL_ASSISTANT).first()).toBeVisible({
      timeout: 45000,
    });

    // Wait for the first turn's stream to fully complete. The assistant
    // message becomes visible as soon as the first chunk arrives, but the
    // chat input stays in "responding" state until the full stream ends.
    // Rather than race with that, wait for the assistant text to stabilize
    // (no new content for 2 seconds).
    const firstAssistant = page.locator(SLOT_LABEL_ASSISTANT).first();
    let previousText = "";
    await expect
      .poll(
        async () => {
          const text = (await firstAssistant.textContent()) ?? "";
          const stable = text.length > 0 && text === previousText;
          previousText = text;
          return stable;
        },
        { timeout: 30000, intervals: [2000] },
      )
      .toBe(true);

    // Turn 2 — the slot should wrap every assistant turn, not just the first.
    await input.fill("Give me a fun fact");
    await sendBtn().click();

    // Expect at least two custom-wrapped assistant messages.
    await expect
      .poll(async () => await page.locator(SLOT_LABEL_ASSISTANT).count(), {
        timeout: 45000,
      })
      .toBeGreaterThanOrEqual(2);
  });
});
