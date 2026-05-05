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

/** Max attempts for the fill+press verify-and-retry loop. */
const SEND_VERIFY_MAX_ATTEMPTS = 3;
/** How long to wait after pressing Enter before checking for a user message. */
const SEND_VERIFY_INITIAL_DELAY_MS = 500;
/** Total time budget per attempt to see a user message appear. */
const SEND_VERIFY_TIMEOUT_MS = 2_000;

const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;
const DEFAULT_SETTLE_MS = 1500;
const SELECTOR_PROBE_TIMEOUT_MS = 5_000;
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
  /**
   * Read the current value of an input/textarea element. Used by the
   * `skipFill` path to poll for non-empty content before pressing Enter
   * (e.g. voice transcription populating the textarea asynchronously).
   *
   * Optional — only required when `skipFill` turns are used. The real
   * Playwright Page has this method natively. Tests inject a scripted
   * implementation.
   */
  inputValue?(selector: string): Promise<string>;
}

export interface ConversationTurn {
  /** The user message to type into the chat input. */
  input: string;
  /**
   * When true, the runner skips `page.fill()` for this turn's input.
   * Instead it waits for the textarea to contain non-empty text (e.g.
   * populated by a `preFill` callback such as a voice-transcription
   * sample button click) and then presses Enter to submit whatever is
   * already in the field.
   *
   * This is essential for voice/audio flows where `preFill` triggers
   * an async transcription that populates the textarea — calling
   * `page.fill()` would overwrite the transcribed text.
   *
   * When `skipFill` is true, the `input` field value is ignored for
   * fill purposes (it can be set to an empty string or a descriptive
   * label for logging).
   */
  skipFill?: boolean;
  /**
   * Optional callback executed BEFORE the runner fills the chat input
   * and presses Enter for this turn. Use this to click attachment
   * buttons, set up DOM state, or perform any per-turn pre-work that
   * must complete before the user message is sent. The callback
   * receives the page so it can issue clicks / fills / waits.
   *
   * If `preFill` throws, the turn is recorded as failed at index N
   * with the thrown error message — same failure semantics as the
   * post-settle `assertions` callback. The runner does NOT fill or
   * press for that turn, and the conversation stops (no subsequent
   * turns run, matching how the runner already handles fill/press
   * and assertion failures).
   */
  preFill?: (page: Page) => Promise<void>;
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

  console.debug("[conversation-runner] starting conversation", {
    totalTurns: total,
    settleMs,
    chatInputSelector: opts.chatInputSelector ?? "(cascade)",
  });

  // Empty turns array: return zeroes immediately, no page interaction.
  if (total === 0) {
    console.debug(
      "[conversation-runner] empty turns array — returning immediately",
    );
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
    console.debug("[conversation-runner] resolved chat input selector", {
      selector: chatInputSelector,
    });
  } catch (err) {
    console.debug("[conversation-runner] chat input selector cascade FAILED", {
      error: errorMessage(err),
    });
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
  console.debug(
    "[conversation-runner] initial baseline assistant message count",
    {
      baselineCount,
    },
  );

  for (let idx = 0; idx < total; idx++) {
    const turn = turns[idx]!;
    const turnNum = idx + 1;
    const turnTimeoutMs = turn.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
    const startedAt = Date.now();

    console.debug(
      `[conversation-runner] turn ${turnNum}/${total} — sending message`,
      {
        input: turn.input,
        timeoutMs: turnTimeoutMs,
        baselineCount,
      },
    );

    try {
      if (turn.preFill) {
        console.debug(
          `[conversation-runner] turn ${turnNum}/${total} — running preFill hook`,
        );
        await turn.preFill(page);
        console.debug(
          `[conversation-runner] turn ${turnNum}/${total} — preFill hook completed`,
        );
      }

      if (turn.skipFill) {
        console.debug(
          `[conversation-runner] turn ${turnNum}/${total} — skipFill=true, waiting for textarea content then pressing Enter`,
        );
        await waitForContentAndSend(page, chatInputSelector, turnTimeoutMs);
      } else {
        await fillAndVerifySend(page, chatInputSelector, turn.input);
      }

      console.debug(
        `[conversation-runner] turn ${turnNum}/${total} — waiting for assistant settle`,
        {
          selector: chatInputSelector,
          baselineCount,
          settleMs,
          timeoutMs: turnTimeoutMs,
        },
      );

      // Wait for the assistant-message count to grow past the baseline
      // and then stay stable for `settleMs`. If the deadline passes
      // before we see growth, fail the turn with a timeout error.
      const newCount = await waitForAssistantSettled({
        page,
        baselineCount,
        settleMs,
        timeoutMs: turnTimeoutMs,
      });

      console.debug(
        `[conversation-runner] turn ${turnNum}/${total} — assistant settled`,
        {
          newCount,
          previousBaseline: baselineCount,
          hasAssertions: !!turn.assertions,
        },
      );

      if (turn.assertions) {
        console.debug(
          `[conversation-runner] turn ${turnNum}/${total} — running assertions`,
        );
        await turn.assertions(page);
        console.debug(
          `[conversation-runner] turn ${turnNum}/${total} — assertions passed`,
        );
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
      let failureDiagnostics: Record<string, unknown> = {};
      try {
        failureDiagnostics = await page.evaluate(() => {
          const win = globalThis as unknown as {
            document: {
              body: { innerText: string } | null;
              querySelector(s: string): unknown;
            };
          };
          const bodyText =
            win.document.body?.innerText?.slice(0, 500) ?? "(no body)";
          const hasTextarea = !!win.document.querySelector("textarea");
          const hasErrorBoundary =
            bodyText.includes("Application error") ||
            bodyText.includes("Internal Server Error");
          return { bodyText, hasTextarea, hasErrorBoundary };
        });
      } catch {
        /* diagnostics are best-effort */
      }
      console.warn(`[conversation-runner] turn ${turnNum}/${total} — FAILED`, {
        error: errorMessage(err),
        turnsCompleted: idx,
        elapsedMs: Date.now() - startedAt,
        ...failureDiagnostics,
      });
      return {
        turns_completed: idx,
        total_turns: total,
        failure_turn: turnNum,
        error: errorMessage(err),
        turn_durations_ms: durations,
      };
    }
  }

  console.debug("[conversation-runner] conversation completed successfully", {
    turnsCompleted: total,
    totalDurationMs: durations.reduce((a, b) => a + b, 0),
  });

  return {
    turns_completed: total,
    total_turns: total,
    turn_durations_ms: durations,
  };
}

/**
 * Read the current count of user-message DOM nodes via `page.evaluate`.
 * Mirrors `readMessageCount` but targets user bubbles instead of
 * assistant bubbles. Used by `fillAndVerifySend` to detect whether a
 * user message actually appeared after pressing Enter — if the count
 * hasn't grown, the React hydration race likely swallowed the keypress.
 *
 * Returns 0 on any read error (same resilience strategy as
 * `readMessageCount`).
 */
export async function readUserMessageCount(page: Page): Promise<number> {
  try {
    return await page.evaluate(() => {
      const win = globalThis as unknown as {
        document: {
          querySelectorAll(sel: string): { length: number };
        };
      };
      // Try selectors in preference order — first non-zero wins.
      const canonical = win.document.querySelectorAll(
        '[data-testid="copilot-user-message"]',
      );
      if (canonical.length > 0) return canonical.length;
      const tagged = win.document.querySelectorAll(
        '[role="article"][data-message-role="user"]',
      );
      if (tagged.length > 0) return tagged.length;
      const fallback = win.document.querySelectorAll(
        '[data-message-role="user"]',
      );
      return fallback.length;
    });
  } catch {
    return 0;
  }
}

/**
 * Fill the chat input and press Enter, then verify that a user message
 * actually appeared in the DOM. If no user message is detected (the
 * React hydration race swallowed the keypress), retry up to
 * `SEND_VERIFY_MAX_ATTEMPTS` times.
 *
 * After all retries are exhausted without a user message appearing, the
 * function returns silently — the downstream `waitForAssistantSettled`
 * timeout will catch the failure with better diagnostics than we can
 * provide here.
 */
export async function fillAndVerifySend(
  page: Page,
  chatInputSelector: string,
  input: string,
  overrides?: {
    maxAttempts?: number;
    initialDelayMs?: number;
    timeoutMs?: number;
  },
): Promise<void> {
  const maxAttempts = overrides?.maxAttempts ?? SEND_VERIFY_MAX_ATTEMPTS;
  const initialDelay =
    overrides?.initialDelayMs ?? SEND_VERIFY_INITIAL_DELAY_MS;
  const timeout = overrides?.timeoutMs ?? SEND_VERIFY_TIMEOUT_MS;

  const baseline = await readUserMessageCount(page);
  console.debug("[conversation-runner] fillAndVerifySend — start", {
    input: input.slice(0, 100),
    selector: chatInputSelector,
    userMessageBaseline: baseline,
    maxAttempts,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await page.fill(chatInputSelector, input);
    await page.press(chatInputSelector, "Enter");
    console.debug(
      `[conversation-runner] fillAndVerifySend — attempt ${attempt}/${maxAttempts} fill+Enter done`,
    );

    // Wait briefly for React to process the event and render the
    // user message bubble.
    await sleep(initialDelay);

    // Poll until the user message count grows past baseline, or
    // until the per-attempt timeout expires.
    const remainingMs = Math.max(0, timeout - initialDelay);
    const attemptDeadline = Date.now() + remainingMs;
    while (Date.now() < attemptDeadline) {
      const current = await readUserMessageCount(page);
      if (current > baseline) {
        // User message appeared — send succeeded.
        console.debug(
          `[conversation-runner] fillAndVerifySend — user message appeared on attempt ${attempt}`,
          {
            userMessageCount: current,
            baseline,
          },
        );
        return;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    // If this wasn't the last attempt, we'll retry the fill+press.
    console.debug(
      `[conversation-runner] fillAndVerifySend — attempt ${attempt} timed out (no user message growth from baseline=${baseline})`,
    );
  }

  // All attempts exhausted. Proceed anyway — the downstream timeout
  // will produce a clear failure message.
  console.debug(
    "[conversation-runner] fillAndVerifySend — all attempts exhausted, proceeding anyway",
  );
}

/**
 * Wait for the chat input textarea to contain non-empty text (populated
 * externally, e.g. by a voice transcription triggered in `preFill`), then
 * press Enter to submit it. Does NOT call `page.fill()` — the whole
 * point is to preserve whatever was already typed/transcribed into the
 * field.
 *
 * Polls `page.inputValue(selector)` at `POLL_INTERVAL_MS` until the
 * value is non-empty or the `timeoutMs` budget is exhausted. Throws on
 * timeout so the turn's catch block can record the failure.
 *
 * Requires `page.inputValue` to be implemented. The real Playwright Page
 * provides it natively; test fakes must supply a scripted version.
 */
export async function waitForContentAndSend(
  page: Page,
  chatInputSelector: string,
  timeoutMs: number,
): Promise<void> {
  if (!page.inputValue) {
    throw new Error(
      "page.inputValue is required for skipFill turns but is not implemented",
    );
  }

  const deadline = Date.now() + timeoutMs;
  console.debug("[conversation-runner] waitForContentAndSend — start", {
    selector: chatInputSelector,
    timeoutMs,
  });

  while (Date.now() < deadline) {
    const value = await page.inputValue(chatInputSelector);
    if (value.trim().length > 0) {
      console.debug(
        "[conversation-runner] waitForContentAndSend — textarea has content, pressing Enter",
        {
          valueLength: value.length,
          valuePreview: value.slice(0, 100),
        },
      );
      await page.press(chatInputSelector, "Enter");
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `timeout: textarea was not populated within ${timeoutMs}ms (skipFill turn)`,
  );
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
  console.debug("[conversation-runner] resolving chat input selector", {
    candidateCount: candidates.length,
    override: override ?? "(none — using cascade)",
  });
  let lastError: unknown;
  for (const selector of candidates) {
    try {
      await page.waitForSelector(selector, {
        state: "visible",
        timeout: SELECTOR_PROBE_TIMEOUT_MS,
      });
      console.debug("[conversation-runner] chat input selector resolved", {
        selector,
      });
      return selector;
    } catch (err) {
      console.debug("[conversation-runner] chat input selector miss", {
        selector,
        error: err instanceof Error ? err.message : String(err),
      });
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
  let pollCount = 0;
  let lastLoggedCount = lastCount;

  console.debug("[conversation-runner] waitForAssistantSettled — start", {
    baselineCount,
    initialCount: lastCount,
    settleMs,
    timeoutMs,
  });

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const current = await readMessageCount(page);
    pollCount++;
    if (current !== lastCount) {
      console.debug(
        "[conversation-runner] waitForAssistantSettled — message count changed",
        {
          previous: lastCount,
          current,
          baselineCount,
          pollCount,
          elapsedMs: Date.now() - (deadline - timeoutMs),
        },
      );
      lastCount = current;
      lastLoggedCount = current;
      lastChangeAt = Date.now();
      continue;
    }
    // Stable. Settled iff (a) we've grown past baseline AND (b) the
    // quiet window has elapsed. "Stable at baseline" means no response
    // arrived yet — keep polling.
    if (current > baselineCount && Date.now() - lastChangeAt >= settleMs) {
      console.debug("[conversation-runner] waitForAssistantSettled — settled", {
        count: current,
        baselineCount,
        quietWindowMs: Date.now() - lastChangeAt,
        totalPollCount: pollCount,
        totalElapsedMs: Date.now() - (deadline - timeoutMs),
      });
      return current;
    }
    // Log a periodic status when still waiting at baseline (every ~5s)
    if (current === lastLoggedCount && pollCount % 50 === 0) {
      console.debug(
        "[conversation-runner] waitForAssistantSettled — still polling",
        {
          current,
          baselineCount,
          pollCount,
          elapsedMs: Date.now() - (deadline - timeoutMs),
          remainingMs: deadline - Date.now(),
        },
      );
    }
  }
  console.debug("[conversation-runner] waitForAssistantSettled — TIMEOUT", {
    baselineCount,
    lastCount,
    timeoutMs,
    totalPollCount: pollCount,
  });
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
