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

    // Single deadline gates the entire post-sign-out assertion so the
    // total wall-clock STAYS within `timeout` (the previous version
    // had a hardcoded 3s legacy banner-flip wait + 500ms sleep + 2s
    // fill + 2s press + remaining error-poll, all of which could
    // stack to ~15s when the caller asked for 8s — observable
    // contract violation that only surfaced under tight test
    // timeouts).
    const deadline = Date.now() + timeout;
    const remainingMs = (): number => Math.max(0, deadline - Date.now());
    // Idiomatic detection gets the smaller of 3s or the caller's
    // budget — fast-path for a fresh React render. Inner waitForSelector
    // bound to remaining, so a 100ms deadline can't be overshot by a
    // 200ms inner timeout the way the prior 3s-loop-with-200ms-inner
    // could.
    await click(page, SIGN_OUT_BUTTON_SELECTOR);

    const idiomaticBudgetMs = Math.min(3_000, timeout);
    const idiomaticDeadline = Date.now() + idiomaticBudgetMs;
    let signInCardMounted = false;
    while (Date.now() < idiomaticDeadline) {
      const innerTimeout = Math.min(200, idiomaticDeadline - Date.now());
      if (innerTimeout <= 0) break;
      try {
        await page.waitForSelector(SIGN_IN_CARD_SELECTOR, {
          state: "visible",
          timeout: innerTimeout,
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
    // whatever budget remains. If the deadline is already exhausted
    // (caller passed a tight timeout that the idiomatic path consumed),
    // fail fast with a clean message instead of dragging through more
    // hardcoded sub-timeouts.
    if (remainingMs() <= 0) {
      throw new Error(
        `auth: neither idiomatic SignInCard re-mount nor legacy banner-flip happened within ${timeout}ms after sign-out — idiomatic detection consumed the budget`,
      );
    }
    // We already clicked sign-out above; legacy-path needs the
    // banner-flip + probe-send + error-surface flow but starts AFTER
    // the click.
    try {
      await page.waitForSelector(AUTH_BANNER_UNAUTHENTICATED_SELECTOR, {
        state: "visible",
        timeout: Math.min(3_000, remainingMs()),
      });
    } catch {
      throw new Error(
        `auth: neither idiomatic SignInCard re-mount nor legacy banner-flip happened within ${timeout}ms — auth flow may have regressed in BOTH shapes`,
      );
    }
    // Allow useEffect to flush setHeaders() — capped at the remaining
    // budget so a tight caller-timeout doesn't oversleep the deadline.
    await new Promise<void>((r) => setTimeout(r, Math.min(500, remainingMs())));
    // Try to push a probe message through; if fill or press fails
    // (textarea not found, selector cascade mismatch, disabled control),
    // capture the error so the eventual "no error surface" failure
    // names the real cause instead of a generic timeout. The error
    // surface MAY already be visible from the sign-out click alone —
    // the polling loop below handles that case — so we don't fail
    // hard on fill/press; we just preserve the diagnostic.
    let probeSendError: string | null = null;
    const fillPressBudget = Math.min(2_000, remainingMs());
    try {
      await page.fill(
        '[data-testid="copilot-chat-textarea"]',
        "post-signout probe",
        { timeout: fillPressBudget },
      );
      await page.press('[data-testid="copilot-chat-textarea"]', "Enter", {
        timeout: Math.min(2_000, remainingMs()),
      });
    } catch (err) {
      probeSendError = err instanceof Error ? err.message : String(err);
    }
    const errorDeadline = deadline;
    while (Date.now() < errorDeadline) {
      if (await probeErrorSurfaceVisible(page)) return;
      await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    const sendNote = probeSendError
      ? ` — probe send failed: ${probeSendError.slice(0, 140)}`
      : "";
    throw new Error(
      `auth: legacy shape — banner flipped to unauthenticated but neither ${ERROR_BANNER_SELECTOR} nor ${ERROR_BOUNDARY_SELECTOR} appeared within the ${timeout}ms total budget after probe send — auth gate may have regressed${sendNote}`,
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
