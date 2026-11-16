import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Each custom slot wraps the default in a `SlotMarker` that sets
// `data-slot-label="<slot-path>"`. That attribute is the canonical signal
// that a slot override took effect end to end. The welcome screen and the
// disclaimer also have their own `data-testid` attributes.
const SLOT_LABEL_ASSISTANT = '[data-slot-label="MessageView.AssistantMessage"]';

function suggestionPill(page: Page, title: string) {
  return page
    .locator('[data-testid="copilot-suggestion"]')
    .filter({ hasText: title });
}

function sendButton(page: Page) {
  return page.locator('[data-testid="copilot-send-button"]').first();
}

describeDemo("chat-slots", "Chat Slots", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("chat-slots"));
  });

  test("custom welcome screen slot renders on first load", async ({ page }) => {
    // The custom welcomeScreen slot replaces the default welcome screen. Its
    // own testid and the testid of the nested welcomeMessage sub-slot both
    // prove the override. Checking both catches a fallback to the default
    // CopilotChat welcome screen.
    const welcome = page.locator('[data-testid="custom-welcome-screen"]');
    await expect(welcome).toBeVisible();

    await expect(
      welcome.locator('[data-testid="custom-welcome-message"]'),
    ).toBeVisible();
  });

  test("both suggestion pills render with verbatim titles", async ({
    page,
  }) => {
    // useConfigureSuggestions registers exactly two pills with
    // available: "always". Both show at once on the welcome screen.
    await expect(suggestionPill(page, "Write a sonnet")).toBeVisible({
      timeout: 15000,
    });

    await expect(suggestionPill(page, "Tell me a joke")).toBeVisible({
      timeout: 15000,
    });
  });

  test('clicking "Tell me a joke" shows the custom assistant message slot', async ({
    page,
  }) => {
    // The pill sends "Tell me a short joke." The agent replies with text, and
    // the CustomAssistantMessage SlotMarker must wrap the reply.
    await suggestionPill(page, "Tell me a joke").first().click();

    // The MessageView.AssistantMessage marker wraps every assistant message.
    // It proves that the override took effect, and that the default
    // CopilotChatAssistantMessage did not render alone.
    await expect(page.locator(SLOT_LABEL_ASSISTANT).first()).toBeVisible({
      timeout: 45000,
    });
  });

  test("custom disclaimer slot renders after the first user message", async ({
    page,
  }) => {
    // Send with the send button: Enter in the textarea sometimes dropped the
    // submit. The message matches an aimock fixture exactly, so the reply is
    // deterministic.
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Say hello in one short sentence");
    await sendButton(page).click();

    // The assistant replies, and the custom slot wraps the reply.
    await expect(page.locator(SLOT_LABEL_ASSISTANT).first()).toBeVisible({
      timeout: 45000,
    });

    // The custom disclaimer slot is below the input in the chat view after
    // the welcome screen. The welcome screen hides it. After the assistant
    // replies, the welcome screen is gone and the disclaimer is visible.
    await expect(page.locator('[data-testid="custom-disclaimer"]')).toBeVisible(
      { timeout: 10000 },
    );
  });

  test("second assistant turn is also wrapped in the custom slot", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");

    // Turn 1. The message matches an aimock fixture, so the reply is
    // deterministic.
    await input.fill("Say hello in one short sentence");
    await sendButton(page).click();
    await expect(page.locator(SLOT_LABEL_ASSISTANT).first()).toBeVisible({
      timeout: 45000,
    });

    // Wait for the stream of the first turn to end. The assistant message
    // shows with the first chunk, but the chat input stays in its
    // "responding" state until the stream ends. So wait until the text of
    // the assistant message stops changing (no new content for 2 seconds).
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

    // Turn 2. The slot must wrap every assistant turn, not only the first.
    await input.fill("Give me a fun fact");
    await sendButton(page).click();

    // Expect at least two assistant messages in the custom wrapper.
    await expect
      .poll(async () => await page.locator(SLOT_LABEL_ASSISTANT).count(), {
        timeout: 45000,
      })
      .toBeGreaterThanOrEqual(2);
  });
});
