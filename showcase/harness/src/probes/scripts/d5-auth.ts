/**
 * D5 — auth script.
 *
 * Drives `/demos/auth` through one user turn that proves the demo's
 * auth lifecycle works end-to-end. Two demo shapes coexist in the
 * showcase right now and the probe accepts EITHER:
 *
 *   - **Idiomatic shape (langgraph-python)**: defaults to UNAUTHENTICATED
 *     on first paint and renders SignInCard. After sign-in, mounts
 *     `<CopilotKit>` + `<CopilotChat>`. Sign-out unmounts the entire
 *     tree. Probe flow: preFill clicks sign-in to mount chat → runner
 *     sends a turn → assertion clicks sign-out and waits for SignInCard
 *     to re-mount (unmount IS the assertion).
 *   - **Legacy shape (the other 17 integrations)**: loads directly into
 *     authenticated state with chat already mounted. Sign-out flips the
 *     banner to `data-authenticated="false"` but leaves <CopilotKit>
 *     mounted; the next request 401s and surfaces an error banner.
 *     Probe flow: preFill is a no-op → runner sends a turn → assertion
 *     clicks sign-out, fires a probe message, and waits for the legacy
 *     error surface.
 *
 * The probe detects which shape is on the page by waiting briefly for
 * the SignInCard's sign-in button. Present → idiomatic; absent →
 * legacy. Either path satisfies the assertion.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

// ── Idiomatic-shape selectors (langgraph-python) ─────────────────────
export const SIGN_IN_BUTTON_SELECTOR = '[data-testid="auth-sign-in-button"]';
export const SIGN_IN_CARD_SELECTOR = '[data-testid="auth-sign-in-card"]';

// ── Shared selector (both shapes have this) ──────────────────────────
export const SIGN_OUT_BUTTON_SELECTOR = '[data-testid="auth-sign-out-button"]';

// ── Legacy-shape selectors (the other 17 integrations) ───────────────
export const AUTH_BANNER_UNAUTHENTICATED_SELECTOR =
  '[data-testid="auth-banner"][data-authenticated="false"]';
export const ERROR_BANNER_SELECTOR = '[data-testid="auth-demo-error"]';
export const ERROR_BOUNDARY_SELECTOR =
  '[data-testid="auth-demo-chat-boundary"]';

const POST_SIGN_OUT_TIMEOUT_MS = 8_000;
const SIGN_IN_DETECT_TIMEOUT_MS = 1_500;
const SIGN_IN_MOUNT_TIMEOUT_MS = 5_000;
const POST_SIGN_IN_CHAT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 200;

export interface AuthAssertionOpts {
  /** Override the post-sign-out wait. Tests use a short value. */
  signOutTimeoutMs?: number;
  /** Override the sign-in-shape detection wait. Tests use a short value. */
  detectTimeoutMs?: number;
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

/** Probe whether either legacy error surface is currently visible. */
async function probeErrorSurfaceVisible(page: Page): Promise<boolean> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelector(sel: string): unknown;
      };
    };
    return Boolean(
      win.document.querySelector('[data-testid="auth-demo-error"]') ||
        win.document.querySelector('[data-testid="auth-demo-chat-boundary"]'),
    );
  })) as boolean;
}

/** Pre-turn-1 hook: detect which demo shape is on the page. If
 *  SignInCard's sign-in button is visible within `detectTimeoutMs`,
 *  treat as idiomatic shape — click it and wait for the chat textarea
 *  to mount. Otherwise treat as legacy shape (already-authenticated)
 *  and return immediately so the runner's normal fill+press hits the
 *  pre-mounted chat. */
export function buildAuthPreFill(
  opts: AuthAssertionOpts = {},
): (page: Page) => Promise<void> {
  const click = opts.click ?? defaultClick;
  const detectTimeout = opts.detectTimeoutMs ?? SIGN_IN_DETECT_TIMEOUT_MS;
  return async (page: Page): Promise<void> => {
    let isIdiomaticShape = false;
    try {
      await page.waitForSelector(SIGN_IN_BUTTON_SELECTOR, {
        state: "visible",
        timeout: detectTimeout,
      });
      isIdiomaticShape = true;
    } catch {
      // Sign-in button not visible — assume legacy shape (demo loads
      // directly into authenticated state, chat already mounted). The
      // runner's normal fill+press will hit it without preFill help.
      isIdiomaticShape = false;
    }

    if (!isIdiomaticShape) return;

    // Idiomatic shape — click sign-in to mount the chat tree.
    await click(page, SIGN_IN_BUTTON_SELECTOR);
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
  const detectTimeout = opts.detectTimeoutMs ?? SIGN_IN_MOUNT_TIMEOUT_MS;
  const click = opts.click ?? defaultClick;
  return async (page: Page): Promise<void> => {
    // Sign-out button must be visible — both shapes show it after auth.
    try {
      await page.waitForSelector(SIGN_OUT_BUTTON_SELECTOR, {
        state: "visible",
        timeout: detectTimeout,
      });
    } catch {
      throw new Error(
        `auth: sign-out button ${SIGN_OUT_BUTTON_SELECTOR} not visible — demo did not reach authenticated state (idiomatic: sign-in click failed; legacy: demo did not load authenticated)`,
      );
    }

    // Detect shape. Idiomatic: SignInCard testid existed at preFill time
    // (we won't re-detect to avoid coupling to preFill state); we use
    // the assistant-bubble presence as a proxy for "chat tree mounted".
    // Simpler approach: just try the idiomatic assertion first (click
    // sign-out, expect SignInCard re-mount) and if SignInCard never
    // mounts within a short detection window, fall back to legacy.
    //
    // We split the timeout: if the idiomatic path is going to succeed,
    // SignInCard re-mount is fast (a fresh React render — typically
    // <500ms). If we don't see it within ~3s, we're on the legacy
    // shape and should switch to the error-surface flow. The total
    // wall-clock budget remains `timeout`.
    await click(page, SIGN_OUT_BUTTON_SELECTOR);

    const idiomaticDeadline = Date.now() + Math.min(3_000, timeout);
    let signInCardMounted = false;
    while (Date.now() < idiomaticDeadline) {
      try {
        await page.waitForSelector(SIGN_IN_CARD_SELECTOR, {
          state: "visible",
          timeout: 200,
        });
        signInCardMounted = true;
        break;
      } catch {
        // Not yet — continue polling.
      }
    }

    if (signInCardMounted) {
      // Idiomatic shape: SignInCard re-mounted. Pass.
      return;
    }

    // Legacy shape: SignInCard never re-mounts because <CopilotKit>
    // stays mounted. Run the legacy error-surface assertion against
    // the remaining time budget.
    const remaining = Math.max(2_000, timeout - 3_000);
    // We already clicked sign-out above; legacy-path needs the
    // banner-flip + probe-send + error-surface flow but starts AFTER
    // the click. Inline the rest of `assertLegacyErrorSurface` minus
    // the click:
    try {
      await page.waitForSelector(AUTH_BANNER_UNAUTHENTICATED_SELECTOR, {
        state: "visible",
        timeout: 3_000,
      });
    } catch {
      throw new Error(
        `auth: neither idiomatic SignInCard re-mount nor legacy banner-flip happened after sign-out — auth flow may have regressed in BOTH shapes (idiomatic timeout: 3s; legacy banner-flip timeout: 3s)`,
      );
    }
    await new Promise<void>((r) => setTimeout(r, 500));
    try {
      await page.fill(
        '[data-testid="copilot-chat-textarea"]',
        "post-signout probe",
        { timeout: 2_000 },
      );
      await page.press('[data-testid="copilot-chat-textarea"]', "Enter", {
        timeout: 2_000,
      });
    } catch {
      // Fall through — error surface may already be visible.
    }
    const errorDeadline = Date.now() + remaining;
    while (Date.now() < errorDeadline) {
      if (await probeErrorSurfaceVisible(page)) return;
      await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(
      `auth: legacy shape — banner flipped to unauthenticated but neither ${ERROR_BANNER_SELECTOR} nor ${ERROR_BOUNDARY_SELECTOR} appeared within ${remaining}ms after probe send — auth gate may have regressed`,
    );
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
