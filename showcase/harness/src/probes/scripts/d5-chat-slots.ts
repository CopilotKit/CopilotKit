/**
 * D5 — chat-slots script.
 *
 * Drives `/demos/chat-slots` through one user turn and verifies the
 * `messageView.assistantMessage` slot override is active in the rendered
 * DOM. Two demo shapes coexist in the showcase right now and the probe
 * accepts EITHER:
 *
 *   - **Idiomatic shape (langgraph-python)**: the demo wraps the default
 *     `<CopilotChatAssistantMessage>` in a `<SlotMarker>` whose outer
 *     span carries `data-slot-label="MessageView.AssistantMessage"`.
 *     See `showcase/integrations/langgraph-python/src/app/demos/chat-slots/slot-wrappers.tsx`.
 *   - **Legacy shape (the other 17 integrations)**: the demo's
 *     `CustomAssistantMessage` component renders with
 *     `data-testid="custom-assistant-message"` directly.
 *
 * Either marker on the page is sufficient evidence the slot wiring
 * fired. If neither is present, the default renderer must be in use
 * — that's the regression the assertion exists to catch.
 *
 * The fixture's user message is a unique substring across the d5-all
 * bundle so aimock matches first-try.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

/** Idiomatic-shape selector — set on the SlotMarker's outer span by
 *  `slot-wrappers.tsx` in langgraph-python. The label mirrors the
 *  SlotMarker's `label` prop verbatim. */
export const SLOT_MARKER_SELECTOR =
  '[data-slot-label="MessageView.AssistantMessage"]';
/** Legacy-shape selector — emitted directly on the custom assistant
 *  message component in the 17 other integrations. */
export const LEGACY_TESTID_SELECTOR =
  '[data-testid="custom-assistant-message"]';
/** Combined selector that matches EITHER marker. Playwright's CSS engine
 *  treats this as an OR — first-match wins. Exported for tests. */
export const CUSTOM_ASSISTANT_MESSAGE_SELECTOR = `${SLOT_MARKER_SELECTOR}, ${LEGACY_TESTID_SELECTOR}`;

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
        `chat-slots: expected assistant-message slot marker (idiomatic ${SLOT_MARKER_SELECTOR} or legacy ${LEGACY_TESTID_SELECTOR}) to render after the assistant reply, but neither was found within ${waitTimeout}ms`,
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
