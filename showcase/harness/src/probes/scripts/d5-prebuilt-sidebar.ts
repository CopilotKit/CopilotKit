/**
 * D5 — prebuilt-sidebar script.
 *
 * Drives `/demos/prebuilt-sidebar` through one user turn and verifies the
 * sidebar surface is rendered AND that messages round-trip inside it.
 * The demo mounts `<CopilotSidebar defaultOpen={true} />` on top of a
 * static main-content page; the sidebar wraps its container in a
 * `.copilotKitSidebar` class (see
 * `packages/react-ui/src/components/chat/Sidebar.tsx`). The chat input
 * inside the sidebar is the only fillable textarea on this page, so the
 * conversation runner's default cascade hits it without further scoping.
 *
 * Assertions:
 *   1. `.copilotKitSidebar` root must be visible (proves the sidebar
 *      component mounted at all — without this, a regression in the
 *      sidebar component itself would show up as "no input found"
 *      which is hard to diagnose).
 *   2. The assistant response must land inside the sidebar root —
 *      i.e. an assistant-message bubble exists as a descendant of
 *      `.copilotKitSidebar`. This rules out a regression where the
 *      sidebar renders the input but the message stream attaches to
 *      the host page instead.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

export const SIDEBAR_ROOT_SELECTOR = ".copilotKitSidebar";

const ROOT_WAIT_TIMEOUT_MS = 5_000;
const SCOPED_MESSAGE_TIMEOUT_MS = 5_000;

/**
 * Verify an assistant message exists inside the sidebar root. Used both
 * directly here and indirectly by the popup script via shared structure.
 */
export async function probeMessageInside(
  page: Page,
  rootSelector: string,
): Promise<boolean> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelector(sel: string): {
          querySelector(sel: string): unknown;
        } | null;
      };
    };
    // Inline the selectors — page.evaluate ships the function as a
    // string and closure refs would not survive. We accept the
    // duplication as the price of one-shot DOM probes.
    const root = win.document.querySelector(".copilotKitSidebar");
    if (!root) return false;
    return Boolean(
      root.querySelector('[data-testid="copilot-assistant-message"]') ||
      root.querySelector('[role="article"]:not([data-message-role="user"])') ||
      root.querySelector('[data-message-role="assistant"]'),
    );
  })) as boolean;
}

export function buildPrebuiltSidebarAssertion(opts?: {
  rootTimeoutMs?: number;
  scopedTimeoutMs?: number;
}): (page: Page) => Promise<void> {
  const rootTimeout = opts?.rootTimeoutMs ?? ROOT_WAIT_TIMEOUT_MS;
  const scopedTimeout = opts?.scopedTimeoutMs ?? SCOPED_MESSAGE_TIMEOUT_MS;
  return async (page: Page): Promise<void> => {
    try {
      await page.waitForSelector(SIDEBAR_ROOT_SELECTOR, {
        state: "visible",
        timeout: rootTimeout,
      });
    } catch {
      throw new Error(
        `prebuilt-sidebar: sidebar root ${SIDEBAR_ROOT_SELECTOR} did not appear within ${rootTimeout}ms`,
      );
    }
    // Poll briefly for an assistant message inside the sidebar. The
    // runner already settled on a global assistant-message count, but
    // we want to be sure the message is INSIDE the sidebar root, not
    // attached elsewhere.
    const deadline = Date.now() + scopedTimeout;
    while (Date.now() < deadline) {
      if (await probeMessageInside(page, SIDEBAR_ROOT_SELECTOR)) {
        return;
      }
      await new Promise<void>((r) => setTimeout(r, 200));
    }
    throw new Error(
      `prebuilt-sidebar: assistant response did not land inside ${SIDEBAR_ROOT_SELECTOR} within ${scopedTimeout}ms`,
    );
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: "hi from the sidebar test",
      assertions: buildPrebuiltSidebarAssertion(),
    },
  ];
}

registerD5Script({
  featureTypes: ["prebuilt-sidebar"],
  fixtureFile: "prebuilt-sidebar.json",
  buildTurns,
});
