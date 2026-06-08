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

import { formatCvdiag } from "./cv-diag.js";

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

/**
 * Stable testid rendered by `@copilotkit/react-core` and
 * `@copilotkit/react-ui` whenever a chat turn ERRORS (the `ErrorMessage`
 * chat bubble, the `UsageBanner`, and the toast `BannerErrorDisplay` all
 * carry it — merged in CopilotKit #5110). When this banner becomes
 * visible during the assistant-settle wait, the turn has failed and the
 * runner can fast-fail instead of burning the full response timeout.
 */
export const ERROR_BANNER_SELECTOR = '[data-testid="copilot-error-banner"]';

/**
 * Max characters of banner text to embed in the thrown
 * `AssistantErroredError` message. This cap is for LOG HYGIENE ONLY — error
 * banners can carry very long copy (stack-ish detail, repeated retry text)
 * and we don't want to dump the whole thing into the runner's failure log.
 *
 * Critically, this truncation is applied ONLY when shaping the thrown
 * message — NOT to the value `waitForAssistantSettled` compares across polls
 * to re-arm fast-fail. Comparing truncated text would make two DIFFERENT
 * errors that share a 300-char prefix (e.g. identical human copy + differing
 * request-id/suffix) look equal, suppressing the fast-fail and forcing the
 * full settle timeout. The comparison therefore uses the FULL banner text;
 * see `readErrorBanner` (returns untruncated text) and the `textChanged`
 * check in `waitForAssistantSettled`.
 */
const BANNER_MESSAGE_MAX_LENGTH = 300;

/**
 * Distinguished error thrown by `waitForAssistantSettled` when the chat
 * error banner becomes visible during the settle wait. Carrying its own
 * type lets callers tell a fast errored turn apart from a slow settle
 * timeout. The conversation runner maps any thrown turn error to the
 * driver's `conversation-error` classification, so an errored turn is
 * reported as a (fast) `conversation-error` rather than waiting out the
 * timeout and racing the wall-clock `feature-timeout`.
 */
export class AssistantErroredError extends Error {
  constructor(bannerText?: string) {
    const detail = bannerText?.trim().slice(0, BANNER_MESSAGE_MAX_LENGTH);
    super(
      detail
        ? `chat errored: copilot-error-banner visible — ${detail}`
        : "chat errored: copilot-error-banner visible",
    );
    this.name = "AssistantErroredError";
  }
}

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
 * Bounded cold-start retry budget. A showcase can paint a TRANSIENT error
 * banner on the FIRST turn while its agent backend / runtime is still warming
 * up; that banner then clears on its own a beat later. PR #5142's fast-fail
 * (`AssistantErroredError`) correctly bails on a SUSTAINED banner, but on
 * turn 1 a single bounded retry — reload the page, re-send the same message —
 * recovers the would-be flap WITHOUT masking a real failure: a banner that
 * SURVIVES the reload+re-send fast-fails again on the 2nd attempt and is
 * re-thrown.
 *
 * Strictly bounded so #5142 stays intact: the retry fires AT MOST ONCE
 * (`coldStartRetries` counter), ONLY on turn 1 (the cold-start window — reload
 * is safe there because no conversation state exists yet), and ONLY for an
 * `AssistantErroredError` (NOT a settle `timeout`, which is a different
 * failure mode). A sustained real banner still fast-fails on the 2nd attempt.
 */
const COLD_START_RETRY_MAX = 1;

/**
 * Floor for the cold-start retry's settle budget (#71/FF20). The retry shares
 * the turn's single deadline so a retried turn cannot run ~2× the budget, but
 * if the first attempt consumed nearly all of it the remaining window can drop
 * below the fast-fail debounce (2 consecutive polls). A zero-or-near-zero retry
 * window would convert a SUSTAINED real banner — which #5142 requires to
 * fast-fail again on the 2nd attempt — into a generic settle timeout, silently
 * weakening that guarantee. Flooring the retry window at a few poll intervals
 * keeps wall-clock close to 1× (never the old ~2×) while preserving the
 * fast-fail debounce so a real banner still re-throws `AssistantErroredError`.
 */
const COLD_START_RETRY_MIN_SETTLE_MS = 3 * POLL_INTERVAL_MS;

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
  /**
   * Reload the page. Used ONLY by the bounded turn-1 cold-start retry: a
   * showcase that paints a transient error banner while its backend is
   * still warming up can be recovered by reloading and re-sending the
   * first message (safe on turn 1 — there is no conversation state to
   * lose). Optional — when absent, the cold-start retry re-sends without a
   * reload. The real Playwright Page provides it natively; test fakes
   * supply a scripted implementation.
   */
  reload?(): Promise<unknown>;
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
   * When true, the runner skips BOTH `page.fill()` AND the Enter press
   * for this turn — `preFill` is expected to have already issued the
   * user message via some other path (e.g. clicking a sample-attachment
   * button that dispatches `agent.addMessage` + `copilotkit.runAgent`).
   *
   * Distinct from `skipFill` (which still presses Enter once the
   * textarea has content): a `skipFill` turn assumes preFill populated
   * the textarea but didn't submit it, while a `skipSend` turn assumes
   * preFill handled the whole submission and the textarea was never
   * touched. Used by the multimodal-sample flow where the sample
   * button auto-sends via the agent surface and the chat textarea
   * stays empty for the entire turn.
   *
   * `skipSend` takes precedence over `skipFill` when both are set.
   * `input` is ignored (used only for log labels).
   */
  skipSend?: boolean;
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

  // Resolve the chat input lazily — same selector for every turn once
  // resolved, but the first resolution is deferred until after turn 1's
  // preFill runs. Demos with an unauthenticated landing surface (auth)
  // don't mount the chat textarea until the user clicks "Sign in", so
  // resolving up front would time out on the SignInCard before preFill
  // ever got a chance to dismiss it. Subsequent turns reuse the cached
  // selector so we don't re-probe per turn.
  let chatInputSelector: string | null = null;
  // Try to resolve the chat input AT BOOT first — when it works
  // (every demo except idiomatic-shape auth), capture the baseline
  // assistant-message count BEFORE turn 1's preFill runs. Demos like
  // /demos/headless-complete fire the user message inside preFill (a
  // chip click), so reading the baseline AFTER preFill would observe
  // the assistant's response already appended and the settle would
  // wait forever for further growth that never comes. The deferred
  // path is only used when boot-time resolution fails — that's
  // specifically the auth shape, where the chat tree mounts later.
  let baselineCount = 0;
  try {
    chatInputSelector = await resolveChatInputSelector(
      page,
      opts.chatInputSelector,
    );
    console.debug(
      "[conversation-runner] resolved chat input selector at boot",
      { selector: chatInputSelector },
    );
    baselineCount = await readMessageCount(page);
    console.debug(
      "[conversation-runner] initial baseline assistant message count (boot)",
      { baselineCount },
    );
  } catch (bootErr) {
    console.debug(
      "[conversation-runner] chat input cascade did not resolve at boot — deferring to post-preFill (auth shape)",
    );
    // CVDIAG: surface the previously-silent boot-time cascade miss. Control
    // flow is unchanged (the deferred post-preFill path still runs); this is
    // just visibility so a never-mounting chat surface (which can correlate
    // with an app that never booted / never forwarded the context header)
    // is greppable. No slug/runId in scope here — this helper is generic.
    console.warn(
      formatCvdiag({
        component: "conversation-runner",
        boundary: "inbound",
        status: "error",
        error: `chat-input cascade miss at boot: ${errorMessage(bootErr).slice(0, 120)}`,
      }),
    );
  }

  for (let idx = 0; idx < total; idx++) {
    const turn = turns[idx]!;
    const turnNum = idx + 1;
    const turnTimeoutMs = turn.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
    const startedAt = Date.now();
    // A SINGLE deadline shared across the first settle wait AND the cold-start
    // retry's settle wait (#71/FF20). Without this the retry would get a fresh
    // full `turnTimeoutMs`, letting a cold-start turn run ~2× its budget. The
    // first wait uses the full `turnTimeoutMs`; the retry wait uses only the
    // time remaining against this deadline.
    const turnDeadline = startedAt + turnTimeoutMs;
    // Bounded once-per-turn cold-start retry counter. Only ever consulted on
    // turn 1 (the cold-start window); declaring it per-iteration scopes it to
    // the turn it protects. The fast-fail retry fires while this is below
    // `COLD_START_RETRY_MAX` (1), so at most one reload+re-send per turn.
    let coldStartRetries = 0;

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

      if (chatInputSelector === null) {
        try {
          chatInputSelector = await resolveChatInputSelector(
            page,
            opts.chatInputSelector,
          );
          console.debug("[conversation-runner] resolved chat input selector", {
            selector: chatInputSelector,
            turnNum,
          });
          baselineCount = await readMessageCount(page);
          console.debug(
            "[conversation-runner] initial baseline assistant message count",
            { baselineCount },
          );
        } catch (err) {
          console.debug(
            "[conversation-runner] chat input selector cascade FAILED",
            { error: errorMessage(err), turnNum },
          );
          return {
            turns_completed: idx,
            total_turns: total,
            failure_turn: turnNum,
            error: `chat input not found: ${errorMessage(err)}`,
            turn_durations_ms: durations,
          };
        }
      }

      // Send (or, for skipSend/skipFill turns, confirm) the user message.
      // Extracted into a closure so the bounded turn-1 cold-start retry can
      // re-send the same message after a `page.reload()` without duplicating
      // the skipSend/skipFill/normal branch logic. `chatInputSelector` is
      // non-null here (resolved above or it returned), so the cast-free
      // local capture is safe.
      const selector = chatInputSelector;
      const sendTurnMessage = async (): Promise<void> => {
        if (turn.skipSend) {
          console.debug(
            `[conversation-runner] turn ${turnNum}/${total} — skipSend=true, preFill handled submission; not touching textarea`,
          );
        } else if (turn.skipFill) {
          console.debug(
            `[conversation-runner] turn ${turnNum}/${total} — skipFill=true, waiting for textarea content then pressing Enter`,
          );
          await waitForContentAndSend(page, selector, turnTimeoutMs);
        } else {
          await fillAndVerifySend(page, selector, turn.input);
        }
      };

      await sendTurnMessage();

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
      //
      // Bounded turn-1 cold-start retry: if the FIRST turn fast-fails with an
      // `AssistantErroredError` (a banner appeared with no response produced —
      // see #5142), the showcase backend may simply have been cold. Retry
      // ONCE: reload the page (safe on turn 1 — no conversation state to lose)
      // and re-send the same message, then re-enter the settle wait. A banner
      // that SURVIVES the retry re-throws (a real failure). Strictly bounded —
      // only turn 1, only once (`coldStartRetries` < `COLD_START_RETRY_MAX`),
      // only a PLAIN-FILL turn (the retry must re-issue the submission; a
      // skipSend/skipFill turn's submission came from `preFill` and a reload
      // would wipe it, so those fast-fail without retry), and only
      // `AssistantErroredError` (NOT a settle timeout). This does NOT widen the
      // catch to generic timeouts and does NOT defeat #5142: a sustained real
      // banner still fast-fails on the 2nd attempt.
      let newCount: number;
      try {
        newCount = await waitForAssistantSettled({
          page,
          baselineCount,
          settleMs,
          timeoutMs: turnTimeoutMs,
        });
      } catch (settleErr) {
        // The cold-start retry can ONLY meaningfully recover a turn it can
        // RE-ISSUE: a plain-fill turn (reload the page + re-fill the textarea +
        // re-send). skipSend/skipFill submissions are issued by `turn.preFill`
        // (skipSend → preFill auto-sent via the agent surface; skipFill →
        // preFill populated the textarea), which a reload would wipe — so for
        // those turns there is nothing to re-issue and the retry could only
        // false-settle against the first attempt's stale DOM, run on an
        // unbounded budget, or no-op. Gate the retry to plain-fill turns; for
        // skipSend/skipFill turns let the original `AssistantErroredError`
        // propagate (PR #5142 fast-fail — the pre-retry behavior for those
        // turns, not a regression).
        const isPlainFillTurn = !turn.skipSend && !turn.skipFill;
        const isColdStartWindow =
          turnNum === 1 &&
          coldStartRetries < COLD_START_RETRY_MAX &&
          isPlainFillTurn;
        if (settleErr instanceof AssistantErroredError && isColdStartWindow) {
          coldStartRetries++;
          console.warn(
            `[conversation-runner] turn ${turnNum}/${total} — cold-start banner fast-fail; reloading + re-sending ONCE before fast-fail`,
            { error: errorMessage(settleErr) },
          );
          // Reload to clear the transient cold-start banner. Safe on turn 1 —
          // no conversation state exists yet — and the plain-fill re-send below
          // re-issues the message the reload cleared. Optional on the structural
          // Page surface — skip cleanly if a caller's page can't reload.
          if (page.reload) {
            await page.reload();
            // Re-resolve the chat input after reload — the DOM was torn down, so
            // the previously-cached selector may no longer be attached.
            chatInputSelector = await resolveChatInputSelector(
              page,
              opts.chatInputSelector,
            );
            // Re-read the baseline so growth is measured against the post-reload
            // message count, then re-send the same message.
            baselineCount = await readMessageCount(page);
          }
          await fillAndVerifySend(page, chatInputSelector, turn.input);
          // Re-enter the settle wait, sharing the turn deadline (#71/FF20) so
          // the retry only ever consumes the time remaining in the turn budget
          // rather than a fresh full `turnTimeoutMs`. A banner that survives
          // this attempt throws again (AssistantErroredError) and the outer
          // catch records the turn failure — #5142 stays intact.
          newCount = await waitForAssistantSettled({
            page,
            baselineCount,
            settleMs,
            timeoutMs: Math.max(
              COLD_START_RETRY_MIN_SETTLE_MS,
              turnDeadline - Date.now(),
            ),
          });
        } else {
          // Not the cold-start case (later turn, already retried, a
          // skipSend/skipFill turn, or a settle timeout) — propagate to the
          // per-turn catch unchanged.
          throw settleErr;
        }
      }

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
      } catch (diagErr) {
        /* diagnostics are best-effort */
        // CVDIAG: surface the previously-silent diagnostics-capture failure
        // on the turn-failure path. The turn failure itself is reported by
        // the caller; this only makes the swallowed capture error greppable
        // (a closed/crashed page can correlate with a dropped-header 503).
        console.warn(
          formatCvdiag({
            component: "conversation-runner",
            boundary: "fixture-match",
            status: "error",
            error: `failure-diagnostics capture failed: ${errorMessage(diagErr).slice(0, 120)}`,
          }),
        );
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
  } catch (readErr) {
    // CVDIAG: surface the previously-silent user-message read error. This
    // helper is polled in a tight loop (fillAndVerifySend), so the line is
    // routed through console.debug (still `grep CVDIAG`-greppable) to avoid
    // flooding warn-level logs on a transient per-poll DOM-read hiccup.
    // Control flow is unchanged — the caller still retries on the returned 0.
    console.debug(
      formatCvdiag({
        component: "conversation-runner",
        boundary: "inbound",
        status: "error",
        error: `user-message read failed: ${errorMessage(readErr).slice(0, 120)}`,
      }),
    );
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
 * Read whether a chat error banner (`[data-testid="copilot-error-banner"]`)
 * is currently VISIBLE in the page, and return its FULL text when present.
 * Visibility (not mere presence) matters: a banner kept in the DOM but
 * hidden (`display:none` / zero-size / `visibility:hidden`) is not an
 * active error. Returns `{ visible: false }` on any read error so a
 * transient DOM hiccup never spuriously fast-fails a turn.
 *
 * Returns the UNTRUNCATED `textContent` on purpose: `waitForAssistantSettled`
 * compares this text across polls to re-arm fast-fail, and truncating here
 * would make two distinct errors sharing a long common prefix compare equal
 * (suppressing the fast-fail). The length cap for log hygiene is applied
 * downstream, only when building the thrown `AssistantErroredError` message
 * (`BANNER_MESSAGE_MAX_LENGTH`).
 *
 * Reached via the same type-erased `globalThis` indirection as
 * `readMessageCount` because the package tsconfig excludes the `dom` lib.
 */
async function readErrorBanner(
  page: Page,
): Promise<{ visible: boolean; text?: string }> {
  try {
    return await page.evaluate(() => {
      const win = globalThis as unknown as {
        document: {
          querySelector(sel: string): {
            textContent: string | null;
            getBoundingClientRect(): { width: number; height: number };
          } | null;
        };
        getComputedStyle(el: unknown): {
          display: string;
          visibility: string;
        };
      };
      const el = win.document.querySelector(
        '[data-testid="copilot-error-banner"]',
      );
      if (!el) return { visible: false };
      const style = win.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") {
        return { visible: false };
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        return { visible: false };
      }
      return {
        visible: true,
        // FULL text — see docstring. Truncation happens only when shaping
        // the thrown AssistantErroredError message, never on the value
        // compared across polls to re-arm fast-fail.
        text: el.textContent ?? "",
      };
    });
  } catch {
    return { visible: false };
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
 *
 * Fast-fail (ONE unified rule). Each poll also checks the chat error banner
 * (`[data-testid="copilot-error-banner"]`). We snapshot the banner's
 * visibility AND text ONCE at the turn's baseline (`bannerVisibleAtBaseline`,
 * `bannerTextAtBaseline`), then each poll compute a single boolean:
 *
 *   errorStateNow = banner.visible &&
 *                   (!bannerVisibleAtBaseline ||
 *                    banner.text !== bannerTextAtBaseline)
 *
 * i.e. "an error banner is present in a state that DIFFERS from baseline".
 * This single condition covers BOTH a brand-new banner (none at baseline)
 * AND a persisted banner whose text changed — and it stays true even if the
 * banner text keeps mutating each poll (a retry countdown, a live timestamp,
 * a rotating request-id), because it only requires "differs from baseline",
 * not a stable exact value across polls.
 *
 * We fast-fail (throw `AssistantErroredError`) only when ALL of:
 *   (a) `errorStateNow` is true on 2 CONSECUTIVE polls. A single consecutive
 *       counter debounces BOTH the new-banner and changed-banner cases; any
 *       poll where `errorStateNow` is false resets it to 0. A single isolated
 *       differs-from-baseline poll (a transient toast flicker, a one-poll
 *       text glitch on a succeeding turn) therefore does NOT fire.
 *   (b) the assistant has NOT produced a response this turn — the message
 *       count has NOT grown past `baselineCount`. Success-in-flight wins: if
 *       `current > baselineCount`, we never fast-fail (a non-fatal warning
 *       banner alongside a real answer must not force-fail the turn); the
 *       settle path governs instead.
 *
 * CopilotKit error banners persist across turns, so a stale same-text banner
 * left over from a prior turn keeps `errorStateNow` false (text == baseline,
 * banner was visible at baseline) and is intentionally NOT treated as this
 * turn's error. The full (untruncated) banner text is compared — truncation
 * applies only to the thrown message (`BANNER_MESSAGE_MAX_LENGTH`) — so two
 * errors diverging only after the first 300 chars still differ from baseline.
 *
 * Inherent (now much smaller) limitation: a differs-from-baseline state that
 * flickers true for only single ISOLATED polls (never 2 in a row) won't fire,
 * and a brand-new error whose banner text is byte-identical to a persisted
 * stale banner cannot be distinguished from it (both keep `errorStateNow`
 * false). Both fall back to the settle/timeout path. This is intended.
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
  // Snapshot the error banner's visibility AND text ONCE BEFORE this turn's
  // response arrives. A pre-existing (stale) banner must not be mistaken for
  // this turn's error — but because CopilotKit banners persist across turns,
  // a boolean "was it visible" snapshot alone would disable fast-fail for the
  // whole turn whenever any banner lingered. Capturing the text lets the
  // unified `errorStateNow` condition re-arm on a NEW or text-CHANGED banner
  // even while a stale same-text banner is still on screen.
  const baselineBanner = await readErrorBanner(page);
  const bannerVisibleAtBaseline = baselineBanner.visible;
  const bannerTextAtBaseline = baselineBanner.text;
  // Single debounce counter shared by BOTH the new-banner and changed-banner
  // cases: the number of CONSECUTIVE polls on which `errorStateNow` has been
  // true. Any poll where `errorStateNow` is false resets it to 0. Fast-fail
  // fires once it reaches 2 — see the unified rule in the docstring above.
  let consecutiveErrorPolls = 0;

  console.debug("[conversation-runner] waitForAssistantSettled — start", {
    baselineCount,
    initialCount: lastCount,
    settleMs,
    timeoutMs,
    bannerVisibleAtBaseline,
    bannerTextAtBaseline,
  });

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const current = await readMessageCount(page);
    pollCount++;

    // Unified fast-fail rule. Compute a single boolean: an error banner is
    // present in a state that DIFFERS from baseline (a brand-new banner, OR a
    // persisted banner whose text changed). This stays true even if the text
    // keeps mutating each poll, since it only requires "differs from
    // baseline", not a stable exact value.
    const banner = await readErrorBanner(page);
    const errorStateNow =
      banner.visible &&
      (!bannerVisibleAtBaseline || banner.text !== bannerTextAtBaseline);

    // Condition (b): success-in-flight wins. If the assistant produced a
    // response this turn (count grew past baseline), NEVER fast-fail — a
    // non-fatal warning banner alongside a real answer must not force-fail
    // the turn; the settle path governs. A produced response also disarms
    // the consecutive-error counter so a banner that appears only after the
    // response can't retroactively fire.
    if (current > baselineCount) {
      consecutiveErrorPolls = 0;
    } else if (errorStateNow) {
      // Condition (a): require 2 CONSECUTIVE differs-from-baseline polls
      // before fast-failing, so a single isolated flicker (a transient toast,
      // a one-poll text glitch on a succeeding turn) does not raise a spurious
      // error.
      consecutiveErrorPolls++;
      if (consecutiveErrorPolls >= 2) {
        console.debug(
          "[conversation-runner] waitForAssistantSettled — error banner differs from baseline across 2 consecutive polls (no response produced), fast-failing",
          {
            baselineCount,
            lastCount,
            current,
            pollCount,
            elapsedMs: Date.now() - (deadline - timeoutMs),
            bannerText: banner.text,
            baselineBannerText: bannerTextAtBaseline,
            bannerVisibleAtBaseline,
          },
        );
        throw new AssistantErroredError(banner.text);
      }
    } else {
      // No differing error state this poll → disarm the debounce.
      consecutiveErrorPolls = 0;
    }

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
