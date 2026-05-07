/**
 * D5 — chat-slots script.
 *
 * Drives `/demos/chat-slots` through one user turn and verifies the
 * `messageView.assistantMessage` slot override is active in the rendered
 * DOM. The demo registers `CustomAssistantMessage` (see
 * `showcase/integrations/langgraph-python/src/app/demos/chat-slots/slot-wrappers.tsx`)
 * as the assistant-message slot, which wraps the default
 * `<CopilotChatAssistantMessage>` in a `<SlotMarker>` carrying
 * `data-slot-label="MessageView.AssistantMessage"`. If the slot wiring
 * is broken, the default message renders directly and the marker is
 * absent — the assertion fires loudly so the operator sees a slot
 * regression rather than a generic "no chat" failure.
 *
 * The fixture's user message is a unique substring across the d5-all
 * bundle so aimock matches first-try.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

/** Selector marking the demo's assistant-message SlotMarker. The label
 *  attribute mirrors the SlotMarker's `label` prop in slot-wrappers.tsx
 *  (`"MessageView.AssistantMessage"`) — change one and the other has
 *  to match or this assertion goes red. */
export const CUSTOM_ASSISTANT_MESSAGE_SELECTOR =
  '[data-slot-label="MessageView.AssistantMessage"]';

/** Best-effort wait for the slot wrapper to mount after the assistant
 *  response settles. The runner has already settled on assistant-message
 *  count, so the wrapper SHOULD be present — the budget covers
 *  late-mounting custom slot components. */
const SLOT_WAIT_TIMEOUT_MS = 5_000;

/**
 * Build the assertion that fires after the response settles. Throws when
 * the `CustomAssistantMessage` slot isn't found, since that means the
 * demo regressed to the default assistant message renderer.
 */
export function buildChatSlotsAssertion(opts?: {
  waitTimeoutMs?: number;
}): (page: Page) => Promise<void> {
  const waitTimeout = opts?.waitTimeoutMs ?? SLOT_WAIT_TIMEOUT_MS;
  return async (page: Page): Promise<void> => {
    try {
      await page.waitForSelector(CUSTOM_ASSISTANT_MESSAGE_SELECTOR, {
        state: "visible",
        timeout: waitTimeout,
      });
    } catch {
      throw new Error(
        `chat-slots: expected assistant-message SlotMarker (${CUSTOM_ASSISTANT_MESSAGE_SELECTOR}) to render after the assistant reply, but it was not found within ${waitTimeout}ms`,
      );
    }
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: "verify chat slots are wired",
      assertions: buildChatSlotsAssertion(),
    },
  ];
}

registerD5Script({
  featureTypes: ["chat-slots"],
  fixtureFile: "chat-slots.json",
  buildTurns,
});
