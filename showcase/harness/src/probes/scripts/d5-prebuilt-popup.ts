/**
 * D5 — prebuilt-popup script.
 *
 * Drives `/demos/prebuilt-popup` through one user turn and verifies the
 * popup surface is rendered AND messages round-trip inside it. The demo
 * mounts `<CopilotPopup defaultOpen={true} />` over a static main page;
 * the popup wraps its container in a `.copilotKitPopup` class (see
 * `packages/react-ui/src/components/chat/Popup.tsx`). Because the demo
 * sets `defaultOpen`, the script does not need to click the launcher —
 * but the assertion does check the popup root is present so a regression
 * that disables `defaultOpen` would still fail loudly.
 *
 * Assertions (mirror prebuilt-sidebar pattern):
 *   1. `.copilotKitPopup` root must be visible.
 *   2. Assistant response must land inside `.copilotKitPopup` — proves
 *      the message is attached to the popup tree, not the host page.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

export const POPUP_ROOT_SELECTOR = ".copilotKitPopup";

const ROOT_WAIT_TIMEOUT_MS = 5_000;
const SCOPED_MESSAGE_TIMEOUT_MS = 5_000;

export async function probeMessageInsidePopup(page: Page): Promise<boolean> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelector(sel: string): {
          querySelector(sel: string): unknown;
        } | null;
      };
    };
    const root = win.document.querySelector(".copilotKitPopup");
    if (!root) return false;
    return Boolean(
      root.querySelector('[data-testid="copilot-assistant-message"]') ||
      root.querySelector('[role="article"]:not([data-message-role="user"])') ||
      root.querySelector('[data-message-role="assistant"]'),
    );
  })) as boolean;
}

export function buildPrebuiltPopupAssertion(opts?: {
  rootTimeoutMs?: number;
  scopedTimeoutMs?: number;
}): (page: Page) => Promise<void> {
  const rootTimeout = opts?.rootTimeoutMs ?? ROOT_WAIT_TIMEOUT_MS;
  const scopedTimeout = opts?.scopedTimeoutMs ?? SCOPED_MESSAGE_TIMEOUT_MS;
  return async (page: Page): Promise<void> => {
    try {
      await page.waitForSelector(POPUP_ROOT_SELECTOR, {
        state: "visible",
        timeout: rootTimeout,
      });
    } catch {
      throw new Error(
        `prebuilt-popup: popup root ${POPUP_ROOT_SELECTOR} did not appear within ${rootTimeout}ms — defaultOpen may have regressed`,
      );
    }
    const deadline = Date.now() + scopedTimeout;
    while (Date.now() < deadline) {
      if (await probeMessageInsidePopup(page)) {
        return;
      }
      await new Promise<void>((r) => setTimeout(r, 200));
    }
    throw new Error(
      `prebuilt-popup: assistant response did not land inside ${POPUP_ROOT_SELECTOR} within ${scopedTimeout}ms`,
    );
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: "hi from the popup test",
      assertions: buildPrebuiltPopupAssertion(),
    },
  ];
}

registerD5Script({
  featureTypes: ["prebuilt-popup"],
  fixtureFile: "prebuilt-popup.json",
  buildTurns,
});
