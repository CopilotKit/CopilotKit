/**
 * D5 — multi-turn conversation runner.
 *
 * Drives a sequence of turns through a CopilotKit chat surface in a
 * Playwright Page. Each turn:
 *
 *   1. Locate the chat input via a 6-selector cascade (mirrors
 *      `e2e-demos.ts` so showcases that don't yet expose
 *      `[data-testid="copilot-chat-input"]` still get probed).
 *   2. Fill the input, press Enter.
 *   3. Wait for the assistant response to "settle" — defined as no growth
 *      in the assistant-message DOM count for `assistantSettleMs` ms
 *      (default 1500). Polls via `page.evaluate` so the DOM read is
 *      synchronous on the browser side and not blocked by Playwright's
 *      auto-wait machinery.
 *   4. Run the turn's optional `assertions(page)` callback.
 *
 * On any failure (chat-input not found, fill/press throw, response
 * timeout, assertion throw) the runner records the turn index (1-based),
 * the error message, and returns immediately — subsequent turns are NOT
 * executed. Per-turn duration is recorded regardless of success/failure
 * so callers can see where time was spent.
 *
 * Page is a structural minimal type (NOT the full playwright `Page`) so
 * unit tests can hand in a scripted fake without spinning up chromium.
 * Production callers pass a real Playwright Page — TypeScript's
 * structural typing makes it transparent.
 */

/** Chat-input selector cascade — matches `e2e-demos.ts` READY_SELECTORS.
 *
 * Ordering (load-bearing — Playwright `fill()` only works on
 * input/textarea/select/contenteditable elements; matching the wrapper
 * `<div data-testid="copilot-chat-input">` resolves visibly but throws
 * on `fill()`. So the cascade MUST resolve to a real fillable element):
 *
 *   1. CopilotKit V2 canonical textarea testid — the actual `<textarea>`
 *      element inside the V2 chat input. Strictest, fillable signal.
 *   2. Scoped descendant — any `<textarea>` nested under the V2 wrapper
 *      `[data-testid="copilot-chat-input"]`, for V2 UIs whose textarea
 *      doesn't carry its own testid.
 *   3. Bare `textarea` — covers V1 CopilotKit and generic chat UIs whose
 *      composer is a plain `<textarea>` without a testid.
 *   4. Default placeholder — V1/V2 input-element composers whose UI uses
 *      `<input placeholder="Type a message">` instead of a textarea.
 *   5-6. Generic chat-affordance fallbacks for custom-composer demos
 *        (e.g. `headless-simple`) that build their own UI on top of
 *        `useAgent` and lack both the testid and placeholder.
 *
 * Note: the V2 wrapper selector `[data-testid="copilot-chat-input"]` is
 * intentionally OMITTED here — it matches a `<div>` wrapper, and
 * `page.fill()` would always throw on it ("Element is not an
 * <input>, <textarea>, <select> or [contenteditable]"). The visibility-
 * only `e2e-demos.ts` cascade keeps the same ordering for parity but the
 * wrapper selector can land further down without affecting that driver.
 *
 * Kept as a const tuple so it's literally the same shape as the
 * e2e-demos cascade. Any divergence is a refactor signal, not a feature.
 */
const CHAT_INPUT_SELECTORS = [
  '[data-testid="copilot-chat-textarea"]',
  '[data-testid="copilot-chat-input"] textarea',
  "textarea",
  'input[placeholder="Type a message"]',
  'input[type="text"]',
  '[role="textbox"]',
] as const;

/**
 * Canonical assistant-message selector. Used by `readMessageCount`
 * and re-exported so sibling helpers / scripts (`_hitl-shared`,
 * `_gen-ui-shared`, `d5-agentic-chat`, `d5-shared-state`) all read
 * the same DOM nodes the runner uses to detect "response settled".
 *
 * Drift between this and any sibling reader meant the runner could
 * settle on N messages while a sibling read N+M (counting user
 * bubbles toward the assistant total). Pinning the selector here is
 * the single-source-of-truth fix.
 *
 * The cascade has three preferences:
 *   1. `[data-testid="copilot-assistant-message"]` — canonical CopilotKit testid.
 *   2. `[role="article"]:not([data-message-role="user"])` — generic
 *      ARIA + explicit user-bubble exclusion. This clause is
 *      load-bearing: some composers tag their bubbles
 *      `[role="article"][data-message-role="user"]` and a bare
 *      `[role="article"]` would over-count.
 *   3. `[data-message-role="assistant"]` — last-resort fallback for
 *      headless / custom-composer demos that don't wrap bubbles in
 *      `[role="article"]` at all. The headless-simple template tags
 *      its assistant `<div>` with `data-message-role="assistant"` so
 *      the runner can still detect "response settled" without the
 *      canonical CopilotKit testids being present.
 */
export const ASSISTANT_MESSAGE_PRIMARY_SELECTOR =
  '[data-testid="copilot-assistant-message"]';
export const ASSISTANT_MESSAGE_FALLBACK_SELECTOR =
  '[role="article"]:not([data-message-role="user"])';
export const ASSISTANT_MESSAGE_HEADLESS_SELECTOR =
  '[data-message-role="assistant"]';

const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;
const DEFAULT_SETTLE_MS = 1500;
const SELECTOR_PROBE_TIMEOUT_MS = 2_000;
const POLL_INTERVAL_MS = 100;

/**
 * Minimal Page surface the runner depends on. Real `playwright.Page`
 * satisfies this structurally; tests inject scripted fakes. We
 * intentionally do NOT import `playwright`'s Page type — pulling DOM
 * lib into this module would force every consumer to acquire DOM types
 * just to call the helper, and the runner only needs four methods.
 */
export interface Page {
  waitForSelector(
    selector: string,
    opts?: { timeout?: number; state?: "visible" },
  ): Promise<unknown>;
  fill(
    selector: string,
    value: string,
    opts?: { timeout?: number },
  ): Promise<void>;
  press(
    selector: string,
    key: string,
    opts?: { timeout?: number },
  ): Promise<void>;
  /**
   * Run a function in the browser page context. The runner uses this
   * (NOT `page.textContent(...)`) for the assistant-message count poll
   * because Playwright's selector-based reads auto-wait up to 30 s,
   * which would defeat the polling cadence.
   */
  evaluate<R>(fn: () => R): Promise<R>;
}

export interface ConversationTurn {
  /** The user message to type into the chat input. */
  input: string;
  /**
   * Optional assertion callback executed AFTER the assistant response
   * settles. Any throw from this function is captured as the turn's
   * failure and stops the conversation.
   */
  assertions?: (page: Page) => Promise<void>;
  /**
   * Per-turn override for the assistant-response timeout. Defaults to
   * 30 s (`DEFAULT_RESPONSE_TIMEOUT_MS`). A turn whose response fails
   * to settle within this budget fails with `error: "timeout: ..."`.
   */
  responseTimeoutMs?: number;
}

export interface ConversationResult {
  /** Number of turns that completed successfully (0-indexed count). */
  turns_completed: number;
  /** Total turns the runner was asked to execute. */
  total_turns: number;
  /** 1-indexed turn that failed; absent iff every turn succeeded. */
  failure_turn?: number;
  /** Human-readable failure summary; absent iff every turn succeeded. */
  error?: string;
  /**
   * Wall-clock duration of each successful turn in milliseconds. Length
   * always equals `turns_completed` — the failed turn's partial
   * duration is intentionally NOT recorded so callers can compute
   * average successful-turn latency without partial-failure outliers
   * skewing the result.
   */
  turn_durations_ms: number[];
}

export interface ConversationRunnerOptions {
  /**
   * Override the chat-input selector. When set, the 6-selector cascade
   * is skipped and only this selector is tried. Useful for showcases
   * with non-standard chat UIs where the cascade would mis-match.
   */
  chatInputSelector?: string;
  /**
   * Quiet window for "response complete" detection. The runner polls
   * the assistant-message DOM count every ~100 ms; once the count is
   * positive AND has not grown for `assistantSettleMs` ms, the
   * response is considered complete. Default 1500 ms.
   */
  assistantSettleMs?: number;
}

/**
 * Run a multi-turn conversation. Returns a `ConversationResult`
 * regardless of success/failure — callers should not throw out of this
 * helper. Each turn's duration is captured, even when the turn fails.
 */
export async function runConversation(
  page: Page,
  turns: ConversationTurn[],
  opts: ConversationRunnerOptions = {},
): Promise<ConversationResult> {
  const total = turns.length;
  const settleMs = opts.assistantSettleMs ?? DEFAULT_SETTLE_MS;
  const durations: number[] = [];

  // Empty turns array: return zeroes immediately, no page interaction.
  if (total === 0) {
    return {
      turns_completed: 0,
      total_turns: 0,
      turn_durations_ms: [],
    };
  }

  // Resolve the chat input ONCE up front — same selector for every
  // turn. The cascade probe is cheap on the canonical case (first
  // selector wins on conformant showcases) and the resolved selector
  // is reused so we don't re-probe per turn.
  let chatInputSelector: string;
  try {
    chatInputSelector = await resolveChatInputSelector(
      page,
      opts.chatInputSelector,
    );
  } catch (err) {
    return {
      turns_completed: 0,
      total_turns: total,
      failure_turn: 1,
      error: `chat input not found: ${errorMessage(err)}`,
      turn_durations_ms: [],
    };
  }

  // Initial assistant-message count BEFORE turn 1 — usually 0 on a
  // fresh page, but a probe that lands on a page with prior history
  // (e.g. a session that was rehydrated) would see a non-zero starting
  // count, and we need to wait for growth from that baseline rather
  // than from 0.
  let baselineCount = await readMessageCount(page);

  for (let idx = 0; idx < total; idx++) {
    const turn = turns[idx]!;
    const turnNum = idx + 1;
    const turnTimeoutMs = turn.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
    const startedAt = Date.now();

    try {
      await page.fill(chatInputSelector, turn.input);
      await page.press(chatInputSelector, "Enter");

      // Wait for the assistant-message count to grow past the baseline
      // and then stay stable for `settleMs`. If the deadline passes
      // before we see growth, fail the turn with a timeout error.
      const newCount = await waitForAssistantSettled({
        page,
        baselineCount,
        settleMs,
        timeoutMs: turnTimeoutMs,
      });

      if (turn.assertions) {
        await turn.assertions(page);
      }

      durations.push(Date.now() - startedAt);
      baselineCount = newCount;
    } catch (err) {
      // Spec: `turn_durations_ms.length === turns_completed`. The failed
      // turn's partial duration is intentionally NOT recorded so callers
      // can compute average successful-turn latency without partial-
      // failure outliers skewing the result. The wall-clock cost of the
      // failed turn is still recoverable from `observedAt` deltas if
      // operators need it.
      void startedAt;
      return {
        turns_completed: idx,
        total_turns: total,
        failure_turn: turnNum,
        error: errorMessage(err),
        turn_durations_ms: durations,
      };
    }
  }

  return {
    turns_completed: total,
    total_turns: total,
    turn_durations_ms: durations,
  };
}

/**
 * Probe the 6-selector cascade and return the first one that resolves.
 * When `override` is provided, only that selector is tried. Each probe
 * uses a short timeout (`SELECTOR_PROBE_TIMEOUT_MS`) so the cascade
 * doesn't multiply the page-level timeout by 5x on showcases where
 * none of the selectors match.
 */
async function resolveChatInputSelector(
  page: Page,
  override: string | undefined,
): Promise<string> {
  const candidates = override ? [override] : CHAT_INPUT_SELECTORS;
  let lastError: unknown;
  for (const selector of candidates) {
    try {
      await page.waitForSelector(selector, {
        state: "visible",
        timeout: SELECTOR_PROBE_TIMEOUT_MS,
      });
      return selector;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("no chat input selector matched");
}

/**
 * Read the current count of assistant-message DOM nodes via
 * `page.evaluate`. Returns 0 on any read error — the caller's polling
 * loop will retry, so a transient DOM-read hiccup doesn't fail the
 * whole turn.
 *
 * The DOM types are reached via a type-erased indirection because the
 * package's tsconfig intentionally excludes the `dom` lib (server-side
 * Node code). Same pattern used in `e2e-smoke.ts`.
 */
async function readMessageCount(page: Page): Promise<number> {
  try {
    return await page.evaluate(() => {
      const win = globalThis as unknown as {
        document: {
          querySelectorAll(sel: string): { length: number };
        };
      };
      // Match either the canonical CopilotKit testid or a narrowed
      // `[role="article"]` that excludes user-side articles.
      // The canonical testid wins; if absent, fall back to articles
      // that are explicitly tagged as assistant (or are not tagged
      // user) so we never count user-input bubbles toward "assistant
      // response settled".
      const canonical = win.document.querySelectorAll(
        '[data-testid="copilot-assistant-message"]',
      );
      if (canonical.length > 0) return canonical.length;
      // Prefer an explicit assistant-tagged article when present.
      const tagged = win.document.querySelectorAll(
        '[role="article"][data-message-role="assistant"]',
      );
      if (tagged.length > 0) return tagged.length;
      // Next: any [role="article"] that is NOT explicitly tagged as a
      // user message. This still matches untagged articles (the
      // historical behaviour) but excludes user bubbles that some
      // composers tag with `data-message-role="user"`.
      const fallback = win.document.querySelectorAll(
        '[role="article"]:not([data-message-role="user"])',
      );
      if (fallback.length > 0) return fallback.length;
      // Last resort: headless / custom-composer demos that don't use
      // [role="article"] at all but tag their assistant bubble with
      // `data-message-role="assistant"`. Without this tier the runner
      // would never detect "response settled" on the headless-simple
      // template since none of the prior selectors match its DOM.
      const headless = win.document.querySelectorAll(
        '[data-message-role="assistant"]',
      );
      return headless.length;
    });
  } catch {
    return 0;
  }
}

/**
 * Block until the assistant-message count has grown past `baselineCount`
 * AND remained stable for `settleMs`, OR until `timeoutMs` elapses.
 * Returns the final stable count on success. Throws a `timeout` Error
 * on deadline.
 *
 * Algorithm: poll at `POLL_INTERVAL_MS`. Track `lastChangeAt` — the
 * timestamp of the most recent count change. If the current poll's
 * count is positive, has surpassed baseline, and `now - lastChangeAt
 * >= settleMs`, the response has settled.
 */
async function waitForAssistantSettled(opts: {
  page: Page;
  baselineCount: number;
  settleMs: number;
  timeoutMs: number;
}): Promise<number> {
  const { page, baselineCount, settleMs, timeoutMs } = opts;
  const deadline = Date.now() + timeoutMs;
  let lastCount = await readMessageCount(page);
  let lastChangeAt = Date.now();

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const current = await readMessageCount(page);
    if (current !== lastCount) {
      lastCount = current;
      lastChangeAt = Date.now();
      continue;
    }
    // Stable. Settled iff (a) we've grown past baseline AND (b) the
    // quiet window has elapsed. "Stable at baseline" means no response
    // arrived yet — keep polling.
    if (current > baselineCount && Date.now() - lastChangeAt >= settleMs) {
      return current;
    }
  }
  throw new Error(
    `timeout: assistant did not respond within ${timeoutMs}ms (baseline=${baselineCount}, current=${lastCount})`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
