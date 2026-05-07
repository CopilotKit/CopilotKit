/**
 * D5 — auth script.
 *
 * Drives `/demos/auth` through one user turn that proves the demo's
 * mount/unmount auth lifecycle works end-to-end:
 *
 *   1. preFill: the demo defaults to UNAUTHENTICATED on first paint —
 *      the chat surface isn't mounted until the user signs in. Click
 *      the SignInCard's sign-in button to mount `<CopilotKit>` +
 *      `<CopilotChat>` so the runner's chat-input cascade can find
 *      the textarea for turn 1.
 *   2. Runner sends the user message and waits for the assistant
 *      response to settle (proves the bearer header reached the
 *      runtime and the runtime accepted it).
 *   3. assertion: click sign-out, then wait for the SignInCard to
 *      re-mount. The demo unmounts the entire `<CopilotKit>` tree on
 *      sign-out, so SignInCard re-appearing is the canonical proof
 *      that the auth state flipped — no chat-send-and-401 dance is
 *      needed (or possible — there's no chat surface to send into
 *      after unmount).
 *
 * The previous incarnation chased a 401-error-banner surface that
 * existed in the OLD demo (when CopilotKit stayed mounted with stale
 * tokens). The post-refactor demo deliberately avoids that path by
 * unmounting the whole tree, so the unmount marker is the right
 * signal.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

export const SIGN_IN_BUTTON_SELECTOR = '[data-testid="auth-sign-in-button"]';
export const SIGN_IN_CARD_SELECTOR = '[data-testid="auth-sign-in-card"]';
export const SIGN_OUT_BUTTON_SELECTOR = '[data-testid="auth-sign-out-button"]';

const POST_SIGN_OUT_TIMEOUT_MS = 8_000;
const SIGN_IN_MOUNT_TIMEOUT_MS = 5_000;
const POST_SIGN_IN_CHAT_TIMEOUT_MS = 15_000;

export interface AuthAssertionOpts {
  /** Override the post-sign-out wait. Tests use a short value. */
  signOutTimeoutMs?: number;
  /** Click handler injection — page.click() isn't on the structural Page
   * type the runner uses. We expose a hook here so tests can simulate
   * the click without a real Playwright page. */
  click?: (page: Page, selector: string) => Promise<void>;
}

/** Default click implementation: uses `page.evaluate()` to call
 *  `element.click()` directly via JavaScript. Playwright's `force: true`
 *  dispatches pointer events that `<cpk-web-inspector>` intercepts before
 *  React's synthetic event system picks them up — the onClick handler
 *  never fires. The JS-level `.click()` bypasses the overlay entirely
 *  because it triggers the DOM click event without pointer dispatch.
 *
 *  Note: the Page interface's `evaluate` only accepts zero-arg functions,
 *  so we embed the selector in the function body via closure over a
 *  `new Function` constructor to avoid serialization issues. */
const defaultClick = async (page: Page, selector: string): Promise<void> => {
  const code = `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("auth: element " + ${JSON.stringify(selector)} + " not found in DOM");
      el.click();
    })()
  `;
  const fn = new Function(`return ${code.trim()};`) as () => void;
  await page.evaluate(fn);
};

/** Pre-turn-1 hook: click the SignInCard's sign-in button to mount the
 *  `<CopilotKit>` + chat tree, then wait for the chat input to appear
 *  so the runner's fill+press has somewhere to land. */
export function buildAuthPreFill(
  opts: AuthAssertionOpts = {},
): (page: Page) => Promise<void> {
  const click = opts.click ?? defaultClick;
  return async (page: Page): Promise<void> => {
    // Demo defaults to unauthenticated; SignInCard should be on screen.
    try {
      await page.waitForSelector(SIGN_IN_BUTTON_SELECTOR, {
        state: "visible",
        timeout: SIGN_IN_MOUNT_TIMEOUT_MS,
      });
    } catch {
      throw new Error(
        `auth: sign-in button ${SIGN_IN_BUTTON_SELECTOR} not visible — demo did not load in unauthenticated state (SignInCard missing)`,
      );
    }
    await click(page, SIGN_IN_BUTTON_SELECTOR);

    // After click, the parent re-renders into the authenticated branch
    // and mounts <CopilotKit> + <CopilotChat>. Wait for the textarea
    // so the runner's first fill+press doesn't race the mount.
    try {
      await page.waitForSelector(
        '[data-testid="copilot-chat-textarea"], [data-testid="copilot-chat-input"] textarea, textarea',
        {
          state: "visible",
          timeout: POST_SIGN_IN_CHAT_TIMEOUT_MS,
        },
      );
    } catch {
      throw new Error(
        `auth: chat textarea did not mount within ${POST_SIGN_IN_CHAT_TIMEOUT_MS}ms after sign-in — <CopilotKit> may have failed to handshake with the runtime`,
      );
    }
  };
}

export function buildAuthAssertion(
  opts: AuthAssertionOpts = {},
): (page: Page) => Promise<void> {
  const timeout = opts.signOutTimeoutMs ?? POST_SIGN_OUT_TIMEOUT_MS;
  const click = opts.click ?? defaultClick;
  return async (page: Page): Promise<void> => {
    // Step 1 — sign-out button must be visible (we successfully
    // authenticated and the chat surface mounted with AuthBanner).
    try {
      await page.waitForSelector(SIGN_OUT_BUTTON_SELECTOR, {
        state: "visible",
        timeout: 5_000,
      });
    } catch {
      throw new Error(
        `auth: sign-out button ${SIGN_OUT_BUTTON_SELECTOR} not visible — demo did not transition to authenticated state after sign-in`,
      );
    }
    await click(page, SIGN_OUT_BUTTON_SELECTOR);

    // Step 2 — wait for SignInCard to re-mount. The demo unmounts
    // <CopilotKit> entirely on sign-out, so SignInCard reappearing is
    // the canonical proof that the auth state flipped.
    try {
      await page.waitForSelector(SIGN_IN_CARD_SELECTOR, {
        state: "visible",
        timeout,
      });
    } catch {
      throw new Error(
        `auth: SignInCard ${SIGN_IN_CARD_SELECTOR} did not re-mount within ${timeout}ms after clicking sign-out — auth gate may have regressed (tree didn't unmount) or the SignInCard testid drifted`,
      );
    }
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: "auth check turn 1",
      preFill: buildAuthPreFill(),
      assertions: buildAuthAssertion(),
    },
  ];
}

registerD5Script({
  featureTypes: ["auth"],
  fixtureFile: "auth.json",
  buildTurns,
});
