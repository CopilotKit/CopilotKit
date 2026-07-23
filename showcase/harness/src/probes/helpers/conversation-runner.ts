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

import type { Page as PlaywrightPage } from "playwright";
import {
  ASSISTANT_MESSAGE_FALLBACK_SELECTOR,
  ASSISTANT_MESSAGE_HEADLESS_SELECTOR,
  ASSISTANT_MESSAGE_PRIMARY_SELECTOR,
  countAssistantMessages,
  readCascadeStateLast,
} from "./assistant-message-count.js";
import { formatCvdiag } from "./cv-diag.js";

/**
 * Re-exports of the cascade tier constants. Cascade lives in
 * `assistant-message-count.ts` (single source of truth) — these
 * re-exports preserve the historical import path
 * `from "./conversation-runner.js"` used by the d5/d6 sibling scripts
 * (`_hitl-shared`, `_gen-ui-shared`, `d5-agentic-chat`,
 * `d5-shared-state`). New code should import from
 * `./assistant-message-count.js` directly.
 */
export {
  ASSISTANT_MESSAGE_FALLBACK_SELECTOR,
  ASSISTANT_MESSAGE_HEADLESS_SELECTOR,
  ASSISTANT_MESSAGE_PRIMARY_SELECTOR,
};

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
 * message — NOT to the FULL banner text the runner uses when classifying
 * a chat-errored turn. `readErrorBanner` always returns untruncated text;
 * the cap only fires when constructing the thrown `AssistantErroredError`
 * message string.
 */
const BANNER_MESSAGE_MAX_LENGTH = 300;

/**
 * Distinguished error thrown when the chat error banner is observed
 * visible without an accompanying assistant response (the runner now
 * checks the banner on a `TurnNotCompleteError` from `waitForTurnComplete`
 * and re-throws this distinguished class so the caller can tell a fast
 * errored turn apart from a slow settle timeout). The conversation
 * runner maps any thrown turn error to the driver's `conversation-error`
 * classification, so an errored turn is reported as a (fast)
 * `conversation-error` rather than waiting out the timeout and racing
 * the wall-clock `feature-timeout`.
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

/**
 * Distinguished error thrown by `waitForTurnComplete` when the chat error
 * banner has been visible for 2 consecutive polls during the in-poll
 * banner-check (a "sustained" banner). The runner's outer catch translates
 * this into `AssistantErroredError` so the historical fast-fail surface
 * (and the bounded turn-1 cold-start retry gating) is preserved.
 *
 * Distinct from the post-`TurnNotCompleteError` banner check: this error
 * fires DURING the settle poll loop (not after the full-timeout throw),
 * so a sustained banner short-circuits the wait instead of burning the
 * full `timeoutMs`. The 2-consecutive-poll debounce keeps a single-poll
 * flicker (a transient toast that auto-dismisses, a render glitch) from
 * spuriously fast-failing a succeeding turn.
 */
export class BannerVisibleError extends Error {
  constructor(readonly bannerText: string) {
    super(
      `waitForTurnComplete: copilot-error-banner visible across 2 consecutive polls — ${bannerText.slice(
        0,
        BANNER_MESSAGE_MAX_LENGTH,
      )}`,
    );
    this.name = "BannerVisibleError";
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
 * Compute the done-signal backstop ceiling for a turn from its hard
 * timeout + settle window. The backstop must be:
 *   - GENEROUSLY above the settle window so a legitimately-slow done-signal
 *     (a multi-step run whose final RUN_FINISHED lands late, after the text
 *     has already settled) is NOT cut off prematurely; and
 *   - comfortably BELOW the hard `timeoutMs` so a genuine
 *     settled-but-never-finished hang reds at `done-signal-missing` instead
 *     of burning the full ceiling (and so a future demotion can never
 *     false-green on DOM+text alone past this point).
 * Chosen as the larger of "several settle windows" and 60% of the hard
 * ceiling, clamped to `timeoutMs`. For the defaults (timeout 30s, settle
 * 1.5s) this is 18s — 12× the settle window, 12s of headroom before the
 * hard ceiling.
 */
function computeMaxTurnDurationMs(
  turnTimeoutMs: number,
  settleMs: number,
): number {
  return Math.min(
    turnTimeoutMs,
    Math.max(settleMs * 4 + POLL_INTERVAL_MS, Math.floor(turnTimeoutMs * 0.6)),
  );
}

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
 * Compute the floor for the cold-start retry's settle budget (#71/FF20 + R8F1).
 * The retry SHARES the turn's single deadline EXCEPT for this floor — if the
 * first attempt consumed nearly the full budget, the retry still gets at least
 * one full settle window plus one poll tick.
 *
 * Why `settleMs + POLL_INTERVAL_MS` and NOT a small constant like
 * `3 * POLL_INTERVAL_MS` (the old value): `waitForTurnComplete` requires
 * `text` to hold stable for `settleMs` before declaring the turn complete. If
 * `timeoutMs < settleMs` the settle gate is MATHEMATICALLY IMPOSSIBLE to
 * satisfy — the loop times out before any settle window can complete and
 * misclassifies the failure as `reason=text-unstable` (hiding the real cause:
 * budget exhausted). The floor must therefore be ≥ `settleMs` so the gate has
 * a real chance to converge; we add one `POLL_INTERVAL_MS` so the loop runs
 * at least one full settle window plus one poll tick.
 *
 * A zero-or-near-zero retry window would convert a SUSTAINED real banner —
 * which #5142 requires to fast-fail again on the 2nd attempt — into a generic
 * settle timeout, silently weakening that guarantee. Total elapsed wall-clock
 * for a retried turn can therefore push slightly past `turnTimeoutMs` (worst
 * case: `turnTimeoutMs + settleMs + POLL_INTERVAL_MS`), but stays far below
 * the old ~2× regime (#71/FF20 pre-fix) while preserving the fast-fail
 * debounce so a real banner still re-throws `AssistantErroredError`.
 */
function coldStartRetryMinSettleMs(settleMs: number): number {
  return settleMs + POLL_INTERVAL_MS;
}

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
   *
   * The `arg` parameter is structurally optional so the runner can call
   * `page.evaluate(() => …)` (no arg) AND `page.evaluate((idx) => …,
   * bubbleIndex)` (one arg) through the SAME signature —
   * `findAssistantBubbleAt` needs the second form to pass the strict
   * bubble index into the browser-side closure without a closure-capture
   * race. The real Playwright `Page.evaluate` is variadic and satisfies
   * both call shapes natively; test fakes that need the arg path read
   * the second runtime arg from `arguments`.
   */
  evaluate<R, A = unknown>(fn: (arg?: A) => R, arg?: A): Promise<R>;
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
   *
   * Receives a `ctx` object carrying the turn-scoped resolution of the
   * assistant bubble for THIS turn:
   *   - `bubbleIndex`: 0-based DOM index of the assistant bubble
   *     produced by this turn (cascade-resolved by the same helper the
   *     runner used to settle the turn).
   *   - `text`: the untruncated `textContent` of that bubble.
   *
   * `ctx` is REQUIRED — the runner sources it from `waitForTurnComplete`'s
   * return value, which always yields a turn-scoped `{ bubbleIndex, text }`
   * pair on success (a failure throws `TurnNotCompleteError` before the
   * assertions callback is invoked). Probes MUST consume `ctx.text`
   * instead of calling `readLastAssistantText` — the latter reads
   * `list[list.length - 1]` and can leak a later turn's bubble into THIS
   * turn's assertions (defect 2). Unit tests driving `turn.assertions`
   * directly must supply a synthetic ctx (`{ bubbleIndex, text }`).
   */
  assertions?: (
    page: Page,
    ctx: { bubbleIndex: number; text: string },
  ) => Promise<void>;
  /**
   * Per-turn override for the assistant-response timeout. Defaults to
   * 30 s (`DEFAULT_RESPONSE_TIMEOUT_MS`). A turn whose response fails
   * to settle within this budget fails with `error: "timeout: ..."`.
   */
  responseTimeoutMs?: number;
  /**
   * Surface-mount completion criterion (OPT-IN). When set, this turn is
   * considered complete on `run-finished + a new assistant bubble + the
   * named render-surface testids mounting` — INSTEAD OF requiring the
   * assistant TEXT bubble to stabilise for `settleMs`.
   *
   * This exists for tool-rendered / declarative-A2UI demos whose
   * MEANINGFUL output is a RENDERED SURFACE, not assistant prose. In the
   * canonical case (`langgraph-python` `declarative-gen-ui`, which uses
   * `a2ui.injectA2UITool: true` → a secondary `render_a2ui` call), the
   * dashboard paints and the run FINISHES, but no assistant text bubble is
   * ever emitted, so the text-stability conjunct can never converge and the
   * turn would otherwise time out with `reason=text-unstable` BEFORE the
   * turn's `assertions` (the real render check) ever runs.
   *
   * Semantics (see `waitForTurnComplete`): the text-stability conjunct is
   * REPLACED — not relaxed — by a surface-mount conjunct for THIS turn. The
   * SSE-run-finished and new-bubble (`count > baselineCount`) conjuncts
   * STILL apply, so this never declares completion before the run actually
   * finished or before a new assistant bubble appeared — it only swaps WHAT
   * the third signal is (rendered surface vs. stable text).
   *
   *   - `testIds`: every render-surface testid that MUST be present in the
   *     DOM for the surface to count as mounted (conjunctive — `every`).
   *   - `minNewMounts`: minimum number of testids (from `testIds`) that must
   *     be NEWLY mounted vs. the pre-send baseline (default 1). The runner
   *     snapshots each testid's count BEFORE sending the turn so a leftover
   *     surface from a prior turn cannot satisfy completion on its own — at
   *     least `minNewMounts` of the expected testids must have grown.
   *
   * Turns that DO NOT set `completeOnMount` are unaffected: the third
   * conjunct remains text-stability exactly as before (text-based demos —
   * agentic-chat, tool-rendering, HITL, etc. — keep their existing settle
   * semantics). This is a per-turn opt-in, not a global mode change.
   */
  completeOnMount?: {
    testIds: readonly string[];
    minNewMounts?: number;
  };
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
  // (every demo except idiomatic-shape auth), we can fall straight into
  // the turn loop without an extra cascade probe per turn. Under the
  // new `waitForTurnComplete` settle path each turn is keyed on its
  // 1-based ordinal (NOT a pre-turn baseline count), so there is no
  // boot-time baseline-count read here anymore: a pre-paint placeholder
  // or stale bubble in the DOM at boot can no longer poison the turn-1
  // settle (defect 4). The deferred path is only used when boot-time
  // resolution fails — that's specifically the auth shape, where the
  // chat tree mounts later.
  try {
    chatInputSelector = await resolveChatInputSelector(
      page,
      opts.chatInputSelector,
    );
    console.debug(
      "[conversation-runner] resolved chat input selector at boot",
      { selector: chatInputSelector },
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
    // time remaining against this deadline, EXCEPT for the floor returned by
    // `coldStartRetryMinSettleMs(settleMs)` (see that function's docstring):
    // if the first attempt nearly exhausted the budget, the retry still gets
    // at least one full settle window plus one poll tick. Total elapsed
    // wall-clock for a retried turn can therefore push slightly past
    // `turnTimeoutMs` (worst case: `turnTimeoutMs + settleMs +
    // POLL_INTERVAL_MS`) — far below the old ~2× regime, while preserving
    // #5142's fast-fail debounce.
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
      },
    );

    try {
      // skipSend baseline hoist: on a `skipSend` turn, `preFill` ITSELF issues
      // the run (it clicks a sample button that dispatches
      // `agent.addMessage` + `copilotkit.runAgent`), so the run-start / bubble
      // baselines MUST be snapshotted BEFORE preFill. A fast in-process runtime
      // (e.g. built-in-agent) fires RUN_STARTED synchronously during preFill;
      // capturing `baselineRunStartCount` AFTER preFill (the normal position)
      // then observes an already-incremented count, making the primary
      // done-signal gate `runStartCount > baselineRunStartCount` impossible to
      // satisfy → a healthy turn false-reds with `done-signal-missing`. Slower
      // runtimes never hit this (RUN_STARTED lands after the capture), so the
      // pre-preFill snapshot is strictly correct for every runtime. Non-skipSend
      // turns are unaffected: their `preFill` never starts a run, so the
      // original post-preFill capture below still reflects only prior-turn runs.
      let skipSendBaselineCount: number | null = null;
      let skipSendBaselineRunStartCount: number | null = null;
      if (turn.skipSend) {
        skipSendBaselineCount = await countAssistantMessages(
          page as unknown as PlaywrightPage,
        );
        skipSendBaselineRunStartCount = (await readCopilotRunning(page))
          .runStartCount;
      }

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

      // Defect-2 sentinel for the multi-bubble hotfix: snapshot the count
      // of assistant bubbles already in the DOM BEFORE this turn submits.
      // Multi-step agents emit >1 bubble per turn — `waitForTurnComplete`
      // gates on `count > baselineCount` to detect "a new bubble appeared
      // for THIS turn" without assuming 1 bubble = 1 turn. Captured BEFORE
      // sendTurnMessage so the assistant can't have started streaming yet
      // (the user message hasn't been submitted), guaranteeing the
      // snapshot reflects only prior-turn bubbles.
      const baselineCount =
        skipSendBaselineCount ??
        (await countAssistantMessages(page as unknown as PlaywrightPage));

      // Multi-step run-start baseline for the PRIMARY DOM done-signal. Snapshot
      // the page-side `runStartCount` BEFORE `sendTurnMessage` — SAME ordering
      // rationale as `baselineCount`: the user message hasn't been submitted
      // yet, so the agent provably cannot have fired RUN_STARTED for THIS turn,
      // guaranteeing this baseline reflects only prior-turn runs. Threaded into
      // `waitForTurnComplete` via `baselineRunStartCount` so the
      // `runStartCount > baselineRunStartCount` gate stays correct even when a
      // fast agent fires RUN_STARTED before the settle wait begins (capturing
      // it inside `waitForTurnComplete`, which runs AFTER the send, would be
      // racy and could kill the PRIMARY signal on fast turns).
      const baselineRunStartCount =
        skipSendBaselineRunStartCount ??
        (await readCopilotRunning(page)).runStartCount;

      // Surface-mount completion (opt-in via `turn.completeOnMount`): snapshot
      // the pre-send testid counts so the settle gate can detect a NEW render
      // surface for THIS turn (vs. a leftover from a prior turn). Captured
      // BEFORE `sendTurnMessage` — same ordering rationale as `baselineCount`:
      // the user message hasn't been submitted yet, so nothing this turn could
      // have mounted. `null` when the turn opts out → the gate keeps requiring
      // text-stability (unchanged for every text-based demo).
      let surfaceReady: ((page: Page) => Promise<boolean>) | null = null;
      if (turn.completeOnMount) {
        const baselineTestIds = await readTestIdCounts(
          page,
          turn.completeOnMount.testIds,
        );
        surfaceReady = buildSurfaceReady(turn.completeOnMount, baselineTestIds);
        console.debug(
          `[conversation-runner] turn ${turnNum}/${total} — surface-mount completion armed`,
          {
            testIds: turn.completeOnMount.testIds,
            minNewMounts: turn.completeOnMount.minNewMounts ?? 1,
            baselineTestIds,
          },
        );
      }

      await sendTurnMessage();

      console.debug(
        `[conversation-runner] turn ${turnNum}/${total} — waiting for assistant settle`,
        {
          selector: chatInputSelector,
          turnIndex: turnNum,
          settleMs,
          timeoutMs: turnTimeoutMs,
        },
      );

      // Wait for the per-turn 3-conjunct gate: SSE run-finished counter
      // has caught up to the turn ordinal, the strict-index bubble for
      // THIS turn exists in the DOM, and that bubble's text has held
      // stable for `settleMs`. On success the primitive returns the
      // turn-scoped `{ bubbleIndex, text }` — the assertions callback
      // receives that ctx directly without re-reading the DOM.
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
      //
      // The cold-start retry's `AssistantErroredError` source: the runner
      // checks for a visible error banner BEFORE calling `waitForTurnComplete`
      // (when no response has yet been produced for this turn) and after the
      // primitive throws `TurnNotCompleteError`. A banner observed at either
      // checkpoint is re-thrown as `AssistantErroredError` so #5142's fast-fail
      // semantics persist across the runner rewrite.
      // Snapshot the baseline banner text BEFORE entering the settle
      // wait. CopilotKit error banners persist across turns, so a banner
      // already visible at this checkpoint is a stale leftover from a
      // prior errored turn — NOT a fresh fast-fail signal for THIS turn.
      // The settle loop's debounce keys on "differs from baseline" rather
      // than mere visibility (see `baselineBannerText` in
      // `WaitForTurnCompleteOpts`), so a stale same-text banner stays
      // ignored and only a NEW or text-CHANGED banner re-arms the
      // fast-fail. An `unreadable` baseline read collapses to `null`
      // (treat-as-absent) — we don't know the baseline so any visible
      // banner during settle is a candidate, preserving the historical
      // "fresh banner ⇒ fast-fail" behaviour on a transient probe hiccup.
      const baselineBanner = await readErrorBanner(page);
      const baselineBannerText =
        baselineBanner.state === "visible" ? baselineBanner.text : null;
      let settleResult: WaitForTurnCompleteResult;
      try {
        settleResult = await waitForTurnComplete({
          page,
          turnIndex: turnNum,
          settleMs,
          timeoutMs: turnTimeoutMs,
          maxTurnDurationMs: computeMaxTurnDurationMs(turnTimeoutMs, settleMs),
          baselineBannerText,
          baselineCount,
          baselineRunStartCount,
          surfaceReady,
        });
      } catch (settleErr) {
        // Translate a turn-incomplete failure observed alongside a
        // copilot-error-banner into the historical `AssistantErroredError`
        // surface so #5142's fast-fail contract — and the cold-start retry
        // gating below — survive the runner rewrite. A banner that's NOT
        // accompanied by a response counts as a chat-errored turn; without
        // a banner the failure propagates as a settle timeout (the
        // `TurnNotCompleteError`'s message preserves the classified reason).
        //
        // `waitForTurnComplete` also throws `BannerVisibleError` directly
        // from its in-poll banner check (a sustained banner observed
        // DURING the settle loop, before the full-timeout throw). We
        // translate that to `AssistantErroredError` here so the historical
        // surface — and the cold-start retry gating below — fire for
        // in-poll fast-fails too.
        let translatedErr: unknown = settleErr;
        if (settleErr instanceof BannerVisibleError) {
          translatedErr = new AssistantErroredError(settleErr.bannerText);
        } else if (settleErr instanceof TurnNotCompleteError) {
          const banner = await readErrorBanner(page);
          if (
            banner.state === "visible" &&
            (baselineBannerText === null || banner.text !== baselineBannerText)
          ) {
            // A visible banner whose text DIFFERS from the pre-turn
            // baseline is a fresh error this turn — translate to the
            // historical AssistantErroredError surface. A banner whose
            // text MATCHES the baseline is a stale leftover (CopilotKit
            // banners persist across turns) and must not convert a
            // settle timeout into a chat-errored failure — surface the
            // original TurnNotCompleteError instead so the operator
            // sees the real reason (sse-missing / dom-missing / etc.).
            translatedErr = new AssistantErroredError(banner.text);
          } else if (banner.state === "unreadable") {
            // Surface the unreadable-banner detail in CVDIAG and propagate
            // the original `TurnNotCompleteError` unchanged — we don't have
            // a banner text to attach, so we cannot honestly classify the
            // turn as a chat-errored turn.
            console.warn(
              formatCvdiag({
                component: "conversation-runner",
                boundary: "fixture-match",
                status: "error",
                error: `post-settle banner read unreadable: ${banner.detail.slice(0, 120)}`,
              }),
            );
          }
        }

        const isPlainFillTurn = !turn.skipSend && !turn.skipFill;
        const isColdStartWindow =
          turnNum === 1 &&
          coldStartRetries < COLD_START_RETRY_MAX &&
          isPlainFillTurn;
        if (
          translatedErr instanceof AssistantErroredError &&
          isColdStartWindow
        ) {
          coldStartRetries++;
          console.warn(
            `[conversation-runner] turn ${turnNum}/${total} — cold-start banner fast-fail; reloading + re-sending ONCE before fast-fail`,
            { error: errorMessage(translatedErr) },
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
          }
          // Explicit narrowing guard. `chatInputSelector` is `string | null`;
          // TypeScript cannot narrow it to non-null across the optional
          // `if (page.reload)` reassignment above, and the no-reload branch
          // retains whatever value flowed in (today: always non-null, since
          // the per-turn resolve at the top of the try block has already
          // executed). Fail LOUD with the DISTINGUISHED `translatedErr`
          // rather than silently calling `fillAndVerifySend` with `null` if a
          // future refactor ever nullifies the selector on this path. This
          // branch is entered specifically because `translatedErr instanceof
          // AssistantErroredError`, so throwing `translatedErr` preserves the
          // distinguished error class that downstream consumers and tests pin
          // (throwing `settleErr` would lose that — the original could be a
          // plain `TurnNotCompleteError` or `BannerVisibleError`).
          if (chatInputSelector === null) {
            throw translatedErr;
          }
          // Re-snapshot the post-reload baseline assistant-bubble count
          // BEFORE the cold-start re-send. The page DOM was torn down by
          // page.reload() so the count is typically 0, but a demo with a
          // prerendered seed conversation could expose pre-existing
          // bubbles — capture the real count so the multi-bubble gate
          // (`count > baselineCount`) cannot misread those as the retry's
          // response.
          const retryBaselineCount = await countAssistantMessages(
            page as unknown as PlaywrightPage,
          );
          // Re-snapshot the post-reload run-start baseline BEFORE the
          // cold-start re-send, mirroring `retryBaselineCount`. page.reload()
          // tore down the page-side run-lifecycle state, so the live count is
          // typically 0; capturing it here — before the re-send — keeps the
          // retry's `runStartCount > baselineRunStartCount` gate measuring the
          // re-send's NEW run rather than carrying the stale pre-reload
          // baseline forward.
          const retryBaselineRunStartCount = (await readCopilotRunning(page))
            .runStartCount;
          // Re-arm surface-mount completion against the post-reload baseline.
          // page.reload() tore down the DOM, so any prior-turn surface is gone
          // — re-snapshot so the retry's delta gate measures growth from the
          // fresh (typically empty) state rather than the stale pre-reload one.
          let retrySurfaceReady: ((page: Page) => Promise<boolean>) | null =
            null;
          if (turn.completeOnMount) {
            const retryBaselineTestIds = await readTestIdCounts(
              page,
              turn.completeOnMount.testIds,
            );
            retrySurfaceReady = buildSurfaceReady(
              turn.completeOnMount,
              retryBaselineTestIds,
            );
          }
          await fillAndVerifySend(page, chatInputSelector, turn.input);
          // Re-snapshot the post-reload baseline banner. The page DOM was
          // torn down + repainted, so any banner now visible is the
          // SECOND attempt's baseline (the cold-start banner may have
          // re-painted, or a fresh banner may have appeared). The retry's
          // fast-fail debounce keys on "differs from THIS retry's
          // baseline" — a re-painted same-text banner is the steady state
          // for the retry attempt and must not auto-fast-fail.
          const retryBaselineBanner = await readErrorBanner(page);
          const retryBaselineBannerText =
            retryBaselineBanner.state === "visible"
              ? retryBaselineBanner.text
              : null;
          // Re-enter the settle wait, sharing the turn deadline (#71/FF20) so
          // the retry only ever consumes the time remaining in the turn budget
          // rather than a fresh full `turnTimeoutMs`. A banner that survives
          // this attempt throws again (AssistantErroredError) and the outer
          // catch records the turn failure — #5142 stays intact.
          try {
            const retryTimeoutMs = Math.max(
              coldStartRetryMinSettleMs(settleMs),
              turnDeadline - Date.now(),
            );
            settleResult = await waitForTurnComplete({
              page,
              turnIndex: turnNum,
              settleMs,
              timeoutMs: retryTimeoutMs,
              maxTurnDurationMs: computeMaxTurnDurationMs(
                retryTimeoutMs,
                settleMs,
              ),
              baselineBannerText: retryBaselineBannerText,
              baselineCount: retryBaselineCount,
              baselineRunStartCount: retryBaselineRunStartCount,
              surfaceReady: retrySurfaceReady,
            });
          } catch (retryErr) {
            if (retryErr instanceof BannerVisibleError) {
              throw new AssistantErroredError(retryErr.bannerText);
            }
            if (retryErr instanceof TurnNotCompleteError) {
              const banner = await readErrorBanner(page);
              if (
                banner.state === "visible" &&
                (retryBaselineBannerText === null ||
                  banner.text !== retryBaselineBannerText)
              ) {
                throw new AssistantErroredError(banner.text);
              }
              if (banner.state === "unreadable") {
                console.warn(
                  formatCvdiag({
                    component: "conversation-runner",
                    boundary: "fixture-match",
                    status: "error",
                    error: `retry post-settle banner read unreadable: ${banner.detail.slice(0, 120)}`,
                  }),
                );
              }
            }
            throw retryErr;
          }
        } else {
          // Not the cold-start case (later turn, already retried, a
          // skipSend/skipFill turn, or a settle timeout) — propagate the
          // translated error to the per-turn catch unchanged.
          throw translatedErr;
        }
      }

      console.debug(
        `[conversation-runner] turn ${turnNum}/${total} — assistant settled`,
        {
          bubbleIndex: settleResult.bubbleIndex,
          textLength: settleResult.text.length,
          hasAssertions: !!turn.assertions,
        },
      );
      // Preserve the runner's diagnostic log contract — Phase 0 Task 0.3
      // / Phase 5 Task 5.1 Step 6 / OPEN ISSUE #4: the bubble-race repro
      // driver parses `[conversation-runner] turn N/total — settled text
      // { turnNum, text: '…' }` out of verbose stdout. The settled-text
      // value is now sourced from `waitForTurnComplete`'s return value
      // (turn-scoped, cascade-consistent, defect-2 safe) instead of a
      // separate post-settle `page.evaluate` read.
      console.debug(
        `[conversation-runner] turn ${turnNum}/${total} — settled text`,
        { turnNum, text: settleResult.text.slice(0, 200) },
      );

      if (turn.assertions) {
        console.debug(
          `[conversation-runner] turn ${turnNum}/${total} — running assertions`,
          {
            bubbleIndex: settleResult.bubbleIndex,
            textLength: settleResult.text.length,
          },
        );
        await turn.assertions(page, {
          bubbleIndex: settleResult.bubbleIndex,
          text: settleResult.text,
        });
        console.debug(
          `[conversation-runner] turn ${turnNum}/${total} — assertions passed`,
        );
      }

      durations.push(Date.now() - startedAt);
    } catch (err) {
      // Spec: `turn_durations_ms.length === turns_completed`. The failed
      // turn's partial duration is intentionally NOT recorded so callers
      // can compute average successful-turn latency without partial-
      // failure outliers skewing the result. The wall-clock cost of the
      // failed turn is still recoverable from `observedAt` deltas if
      // operators need it.
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
 * Mirrors `countAssistantMessages` but targets user bubbles instead of
 * assistant bubbles. Used by `fillAndVerifySend` to detect whether a
 * user message actually appeared after pressing Enter — if the count
 * hasn't grown, the React hydration race likely swallowed the keypress.
 *
 * Returns 0 on any read error (same resilience strategy as
 * `countAssistantMessages`).
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
 * Read the current DOM count of each `[data-testid="<id>"]` selector in
 * ONE browser-side round-trip. Used by the surface-mount completion path
 * (`ConversationTurn.completeOnMount`) to snapshot the pre-send baseline
 * and to poll whether the expected render surface has mounted.
 *
 * Returns a `{ [testId]: count }` map. On any read error every requested
 * testid maps to 0 (same resilience strategy as `countAssistantMessages`
 * / `readUserMessageCount`) so a transient `page.evaluate` hiccup reads as
 * "surface not mounted yet" rather than throwing out of the settle loop.
 *
 * The selectors are passed as an arg into the browser closure (the real
 * Playwright `Page.evaluate` is variadic — the runner's structural `Page`
 * threads the second arg through `arguments`), so the reader stays generic
 * and the caller (a probe script) owns which testids constitute its
 * surface.
 */
export async function readTestIdCounts(
  page: Page,
  testIds: readonly string[],
): Promise<Record<string, number>> {
  const ids = [...testIds];
  try {
    // The selector list is BAKED INTO the closure source via JSON.stringify
    // rather than passed as a `page.evaluate(fn, arg)` argument. The harness
    // worker's `page.evaluate` arg-passing does NOT reliably round-trip the
    // second argument to the browser side (the arg arrives `undefined`), so a
    // captured-arg closure silently reads an empty selector list and reports
    // every testid as absent — exactly the `baselineTestIds: {}` failure that
    // made the A2UI-declarative surface look unmounted. Inlining the literals
    // matches the established zero-arg convention (`_genuine-shared.ts`'s
    // `clickByJs`, `d5-gen-ui-declarative.ts`'s `readDeclarativeTestIds`).
    const code = `
      (() => {
        const ids = ${JSON.stringify(ids)};
        const out = {};
        for (const id of ids) {
          out[id] = document.querySelectorAll('[data-testid="' + id + '"]').length;
        }
        return out;
      })()
    `;
    const fn = new Function(`return ${code.trim()};`) as () => Record<
      string,
      number
    >;
    return await page.evaluate(fn);
  } catch (readErr) {
    // CVDIAG: surface the previously-silent testid read error. Polled in
    // the settle loop, so routed through console.debug (still greppable)
    // to avoid flooding warn-level logs on a transient per-poll hiccup.
    // Control flow is unchanged — the caller reads "all zero" and keeps
    // polling.
    console.debug(
      formatCvdiag({
        component: "conversation-runner",
        boundary: "inbound",
        status: "error",
        error: `testid-count read failed: ${errorMessage(readErr).slice(0, 120)}`,
      }),
    );
    const zero: Record<string, number> = {};
    for (const id of ids) zero[id] = 0;
    return zero;
  }
}

/**
 * Build a surface-mount completion predicate from a turn's
 * `completeOnMount` spec and the pre-send baseline testid counts. The
 * returned predicate resolves `true` once ALL `testIds` are present in the
 * DOM AND at least `minNewMounts` of them have grown vs. the baseline.
 *
 * The "newly mounted" delta gate mirrors the declarative assertion's own
 * leftover guard: A2UI render nodes accumulate across turns, so an
 * absolute-presence check would let a turn complete on a prior turn's
 * leftover surface. Requiring `minNewMounts` of the expected testids to
 * grow guarantees THIS turn actually painted something.
 */
function buildSurfaceReady(
  spec: { testIds: readonly string[]; minNewMounts?: number },
  baseline: Record<string, number>,
): (page: Page) => Promise<boolean> {
  const ids = [...spec.testIds];
  const minNewMounts = spec.minNewMounts ?? 1;
  return async (page: Page): Promise<boolean> => {
    const current = await readTestIdCounts(page, ids);
    const allPresent = ids.every((id) => (current[id] ?? 0) > 0);
    if (!allPresent) return false;
    const newlyMounted = ids.filter(
      (id) => (current[id] ?? 0) > (baseline[id] ?? 0),
    ).length;
    return newlyMounted >= minNewMounts;
  };
}

/**
 * Fill the chat input and press Enter, then verify that a user message
 * actually appeared in the DOM. If no user message is detected (the
 * React hydration race swallowed the keypress), retry up to
 * `SEND_VERIFY_MAX_ATTEMPTS` times.
 *
 * After all retries are exhausted without a user message appearing, the
 * function returns silently — the downstream `waitForTurnComplete`
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
 * Discriminated union returned by `readErrorBanner`. Three states:
 *   - `absent`     — banner element missing / not visible.
 *   - `visible`    — banner is present and visibly painted; `text` is
 *                    the UNTRUNCATED `textContent` for downstream
 *                    comparison / classification.
 *   - `unreadable` — the `page.evaluate` itself threw (a transient DOM
 *                    hiccup, the page is mid-navigation, …). `detail`
 *                    carries the captured error message. Callers MUST
 *                    NOT collapse this into `absent` — an unreadable
 *                    state disables fast-fail for that poll (we don't
 *                    know what the banner is), but it must NOT translate
 *                    a `TurnNotCompleteError` into `AssistantErroredError`
 *                    either (we have no banner text to attach).
 */
export type ErrorBannerReadResult =
  | { state: "absent" }
  | { state: "visible"; text: string }
  | { state: "unreadable"; detail: string };

/**
 * Read whether a chat error banner (`[data-testid="copilot-error-banner"]`)
 * is currently VISIBLE in the page, and return its FULL text when present.
 * Visibility (not mere presence) matters: a banner kept in the DOM but
 * hidden (`display:none` / zero-size / `visibility:hidden`) is not an
 * active error.
 *
 * Returns a 3-state discriminated union — see `ErrorBannerReadResult`.
 * In particular, a transient `page.evaluate` throw is surfaced as
 * `{ state: "unreadable" }` (NOT collapsed to `absent`); collapsing every
 * read error to "no banner" would silently disarm the fast-fail path
 * whenever the page hiccuped, which is the exact failure mode this
 * 3-state union exists to prevent. By the same rule, a browser-side
 * return whose shape does NOT match any known variant
 * (`{state:"absent"}`, `{state:"visible",text}`, `{state:"unreadable",detail}`,
 * or the legacy `{visible,text?}`) is also surfaced as `unreadable` with
 * a short shape summary, NOT collapsed to `absent` — a stale browser
 * script returning a foreign shape must remain observable rather than
 * silently masquerade as "no banner."
 *
 * The visible-state `text` is the UNTRUNCATED `textContent` on purpose:
 * callers may compare this text across polls (e.g. to re-arm fast-fail
 * logic) and truncating here would make two distinct errors sharing a
 * long common prefix compare equal. The length cap for log hygiene is
 * applied downstream, only when building the thrown
 * `AssistantErroredError` / `BannerVisibleError` message
 * (`BANNER_MESSAGE_MAX_LENGTH`).
 *
 * Reached via the same type-erased `globalThis` indirection used in
 * `countAssistantMessages` because the package tsconfig excludes the
 * `dom` lib.
 */
/**
 * Best-effort shape summary for an unknown browser-side return value.
 * Stringifies only TOP-LEVEL KEYS (not values) when `raw` is an object, so
 * the resulting detail message never leaks large payloads. Falls back to
 * `typeof` (and the literal stringified primitive, for non-objects) so the
 * detail is always non-empty. Result is capped at 200 chars including the
 * containing message constructed by the caller.
 */
function safeStringifyShape(raw: unknown): string {
  if (raw === null) return "null";
  const t = typeof raw;
  if (t !== "object") {
    // Primitives: stringify directly but cap length to avoid runaway strings.
    const s = String(raw);
    return `${t}(${s.slice(0, 80)})`;
  }
  try {
    const keys = Object.keys(raw as Record<string, unknown>);
    return `object{keys:${JSON.stringify(keys).slice(0, 120)}}`;
  } catch {
    return "object(unintrospectable)";
  }
}

export async function readErrorBanner(
  page: Page,
): Promise<ErrorBannerReadResult> {
  let raw: unknown;
  try {
    raw = await page.evaluate(() => {
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
      if (!el) return { state: "absent" } as const;
      const style = win.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") {
        return { state: "absent" } as const;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        return { state: "absent" } as const;
      }
      return {
        state: "visible" as const,
        // FULL text — see docstring. Truncation happens only when shaping
        // the thrown error messages, never on the value compared across
        // polls to re-arm fast-fail.
        text: el.textContent ?? "",
      };
    });
  } catch (err) {
    const detail = errorMessage(err).slice(0, 120);
    // CVDIAG: surface the unreadable banner read so it's greppable. We do
    // NOT collapse to `absent` — see docstring.
    console.warn(
      formatCvdiag({
        component: "conversation-runner",
        boundary: "inbound",
        status: "error",
        error: `error-banner read failed: ${detail}`,
      }),
    );
    return { state: "unreadable", detail };
  }
  // Validate the shape — tests (and a future older browser-side script)
  // may return arbitrary values. Anything that isn't the new union shape
  // is treated as "absent" so we never trip on a stale fake.
  if (raw && typeof raw === "object" && "state" in raw) {
    const r = raw as { state: unknown; text?: unknown; detail?: unknown };
    if (r.state === "absent") return { state: "absent" };
    if (r.state === "visible") {
      const text = typeof r.text === "string" ? r.text : "";
      return { state: "visible", text };
    }
    if (r.state === "unreadable") {
      const detail = typeof r.detail === "string" ? r.detail : "";
      return { state: "unreadable", detail };
    }
  }
  // Back-compat: a fake (or legacy browser script) that still returns
  // the old `{ visible, text? }` shape gets translated into the new
  // union so the SUT sees a consistent contract.
  if (raw && typeof raw === "object" && "visible" in raw) {
    const r = raw as { visible: unknown; text?: unknown };
    if (r.visible === true) {
      const text = typeof r.text === "string" ? r.text : "";
      return { state: "visible", text };
    }
    return { state: "absent" };
  }
  // Unknown shape — a stale browser-side script returned something we
  // don't recognize. Per the `ErrorBannerReadResult` docstring, callers
  // MUST NOT collapse an unknown read into `absent` (that would silently
  // disarm fast-fail); surface as `unreadable` with a short shape summary
  // so the failure is observable.
  const detail = (
    "unknown shape from browser-side reader: " + safeStringifyShape(raw)
  ).slice(0, 200);
  return { state: "unreadable", detail };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ============================================================
// waitForTurnComplete — 3-conjunct turn-complete primitive (s8)
// ============================================================
//
// Composes three INDEPENDENT readiness signals into one settle gate
// for a single turn (1-based ordinal):
//
//   1. SSE   — `window.__hk_runsFinished >= turnIndex`. The s7 SSE
//              interceptor increments this counter on each RUN_FINISHED
//              event; reaching the turn ordinal proves the server has
//              flushed its terminal event for THIS turn.
//   2. DOM   — the bubble at strict index `turnIndex - 1` exists under
//              the shared assistant-message cascade. Strict-index — not
//              "last bubble" — because the runner has already seen
//              earlier bubbles and we need turn-local resolution to
//              avoid the "previous turn's text leaks into this turn's
//              assertions" race that motivated this overhaul.
//   3. TEXT  — that bubble's `textContent` is non-empty AND has been
//              stable for `settleMs` ms across consecutive polls. The
//              non-empty guard preserves the defect-1 invariant: an
//              empty pre-paint placeholder must NOT be treated as
//              settled regardless of how long it stays empty.
//
// All three conjuncts must hold simultaneously on the same poll for
// the primitive to return — partial-truth states (DOM without SSE,
// SSE without text, etc.) keep polling until either everything aligns
// or `timeoutMs` elapses.
//
// On timeout we throw `TurnNotCompleteError` with a classified reason
// (sse-missing > dom-missing > text-unstable, in order of precedence
// — the precedence reflects "blame the earliest signal that hadn't
// arrived" so the error message points the operator at the right
// upstream layer). Callers MUST treat the throw as a real failure;
// silently swallowing here defeats the purpose of the gate (see
// fail-loud-discipline upstream).
//
// This is the SOLE settle primitive for the conversation runner —
// `runConversation` calls it directly each turn and consumes its
// `{ bubbleIndex, text }` result as the assertions ctx. The prior
// count-baseline `waitForAssistantSettled` gate was deleted alongside
// this cutover (Phase 5 of the bubble-race-fix plan).

/** Options accepted by `waitForTurnComplete`. */
export interface WaitForTurnCompleteOpts {
  page: Page;
  /** 1-based turn ordinal — the Nth user->assistant exchange in the conversation. */
  turnIndex: number;
  /** Quiescence window the bubble's textContent must hold steady before returning. */
  settleMs: number;
  /** Hard ceiling. Beyond this we throw `TurnNotCompleteError`. */
  timeoutMs: number;
  /**
   * Done-signal backstop ceiling, SEPARATE from `timeoutMs`. Guards the
   * "silent multi-step hang" failure mode: a turn renders a non-empty,
   * text-stable bubble (DOM + TEXT conjuncts satisfied) but NO trustworthy
   * done-signal ever confirms — neither the `data-copilot-running`
   * true→false transition NOR the SSE fetch-counter. Without this, such a
   * turn would otherwise sit DOM+text-stable until the much larger
   * `timeoutMs` elapses; worse, a future demotion that completed on
   * DOM+text alone would FALSE-GREEN a real hang. When DOM + TEXT have
   * held but no done-signal has confirmed within `maxTurnDurationMs`, the
   * gate throws `TurnNotCompleteError(reason="done-signal-missing")` so
   * the hang STILL REDS. `undefined` ⇒ no backstop (legacy callers /
   * unit-test fakes that never exercise the hang path); the runner passes
   * it explicitly. Must be ≤ `timeoutMs` to fire before the hard ceiling.
   */
  maxTurnDurationMs?: number;
  /** Optional poll cadence. Default 100ms — fast enough for fast-replay aimock. */
  pollIntervalMs?: number;
  /**
   * Pre-turn baseline error-banner text snapshot. CopilotKit error banners
   * persist across turns — a banner already visible at THIS turn's baseline
   * is a stale leftover from a prior turn, NOT a fresh fast-fail signal. The
   * fast-fail debounce keys on "current banner text differs from baseline"
   * rather than mere visibility, so a stale same-text banner is ignored and
   * a NEW or text-CHANGED banner re-arms the fast-fail. `null` means no
   * banner was visible at baseline → any fresh banner is a candidate; a
   * string means a banner WAS visible at baseline and only a different text
   * (or a fresh visible-after-absent) counts as a candidate.
   */
  baselineBannerText?: string | null;
  /**
   * Pre-turn baseline assistant-bubble count snapshot. Captured by the
   * runner BEFORE the user message is submitted so the gate can detect
   * "a new bubble appeared for THIS turn" without assuming "1 turn = 1
   * bubble" (multi-step agents — LangGraph, Mastra, CrewAI — emit
   * 2-3+ bubbles per turn: tool-call + tool-render + final-text).
   *
   * Defect-2 protection: the gate requires `count > baselineCount` so a
   * leftover bubble from a prior turn cannot be misread as this turn's
   * response. The settled bubble is then the LAST in the matched cascade
   * tier (read via `readCascadeStateLast`) — for a multi-step turn that's
   * the agent's final-text bubble whose scoped text settles cleanly; for
   * a single-bubble turn that's the only new bubble.
   *
   * When omitted, defaults to `turnIndex - 1` to preserve the
   * pre-multi-step-fix semantics (1 bubble per turn) — used by unit-test
   * fakes that script count progressions keyed to turn ordinals.
   */
  baselineCount?: number;
  /**
   * Pre-turn baseline of the page-side run-start count (`runStartCount` from
   * `data-copilot-running`'s lifecycle summary). Captured by the runner at the
   * CALL SITE — BEFORE `sendTurnMessage` — mirroring `baselineCount`'s
   * ordering: the user message hasn't been submitted yet, so the agent
   * provably cannot have fired RUN_STARTED for THIS turn. The PRIMARY DOM
   * done-signal gates on `runStartCount > baselineRunStartCount` to confirm "a
   * NEW run started THIS turn and then stopped".
   *
   * Why pre-send matters: capturing the baseline INSIDE `waitForTurnComplete`
   * (which the runner only calls AFTER `sendTurnMessage`) is RACY — a fast
   * agent that fires RUN_STARTED between the send and the in-function read
   * leaves the baseline already-incremented, so `runStartCount >
   * baselineRunStartCount` can NEVER hold → the PRIMARY DOM signal is DEAD on
   * fast turns and the turn falls back to the fragile SSE counter (or
   * false-reds via the done-signal-missing backstop). Threading the pre-send
   * baseline here closes that race.
   *
   * When omitted (unit-test fakes / any caller that doesn't snapshot
   * pre-send), the function falls back to reading the baseline at turn entry —
   * the legacy behaviour — so no existing caller breaks.
   */
  baselineRunStartCount?: number;
  /**
   * Surface-mount completion predicate (OPT-IN — set only by the runner
   * when the turn carries `completeOnMount`). When provided, the third
   * settle conjunct is REPLACED: instead of requiring the bubble's TEXT to
   * be non-empty and stable for `settleMs`, the gate completes once
   * `surfaceReady(page)` resolves `true` (the expected render surface has
   * mounted). The SSE-run-finished and new-bubble (`count > baselineCount`)
   * conjuncts STILL apply, so completion never precedes the run finishing
   * or a new assistant bubble appearing — only the THIRD signal changes
   * from "stable text" to "rendered surface".
   *
   * `null` / omitted → the text-stability conjunct is used unchanged. This
   * is how every text-based demo keeps its existing settle semantics — only
   * a turn that opts in via `completeOnMount` ever sees this predicate.
   *
   * Failure classification: when `surfaceReady` is set and the gate times
   * out, the post-loop reason is `surface-missing` (the surface-mount
   * analogue of `text-unstable`) so the operator sees the render surface,
   * not the absent text, was the unmet signal.
   */
  surfaceReady?: ((page: Page) => Promise<boolean>) | null;
}

/** Result of a successful `waitForTurnComplete`. */
export interface WaitForTurnCompleteResult {
  /** 0-based DOM index of the resolved bubble (= turnIndex - 1). */
  bubbleIndex: number;
  /** Untruncated textContent of the resolved bubble at the moment of return. */
  text: string;
}

/**
 * Thrown by `waitForTurnComplete` when `timeoutMs` elapses without all
 * three conjuncts holding. The `reason` field classifies which signal
 * was missing at the FINAL post-loop read (precedence: sse-missing >
 * dom-missing > text-unstable). Carries `turnIndex` + `observedAtMs`
 * (elapsed time inside the loop) so callers + log scrapers can build
 * structured diagnostics without re-parsing the message.
 */
export class TurnNotCompleteError extends Error {
  constructor(
    readonly reason:
      | "sse-missing"
      | "dom-missing"
      | "text-unstable"
      | "done-signal-missing"
      | "surface-missing",
    readonly turnIndex: number,
    readonly observedAtMs: number,
    message: string,
  ) {
    super(message);
    this.name = "TurnNotCompleteError";
  }
}

/**
 * Read the page-side SSE-run counter set by `attachSseInterceptor`.
 * Returns 0 if the counter hasn't been seeded yet (pre-navigation) or
 * if the `evaluate` itself fails — both are equivalent to "no run has
 * finished" from the primitive's vantage.
 */
async function readRunsFinished(page: Page): Promise<number> {
  try {
    return await page.evaluate(
      () =>
        (globalThis as unknown as { __hk_runsFinished?: number })
          .__hk_runsFinished ?? 0,
    );
  } catch {
    return 0;
  }
}

/**
 * Edge-accurate summary of CopilotKit v2's `data-copilot-running`
 * attribute, latched page-side by the MutationObserver
 * `attachSseInterceptor` installs (`window.__hk_copilotRunning`). This is
 * the PRIMARY turn-done signal — transport-independent (driven by the
 * agent run lifecycle RUN_STARTED/RUN_FINISHED, not a fetch monkeypatch).
 *
 * - `attrPresent`     — the `[data-testid="copilot-chat"]` element bearing
 *                       `data-copilot-running` has been seen. `false` ⇒
 *                       this demo doesn't render `CopilotChatView` (a
 *                       headless bring-your-own-UI demo); the gate falls
 *                       back to the SSE counter.
 * - `runningNow`      — live attribute value; `null` when never observed.
 * - `sawRunningTrue`  — latched once the attribute EVER went `true`. The
 *                       primary done-signal gates on the TRANSITION
 *                       (saw-true-then-stopped), never on a bare `false`
 *                       (which is also the never-started baseline).
 * - `runStartCount`   — count of false→true edges. A multi-step turn
 *                       toggles between sub-runs; the gate uses a snapshot
 *                       of this taken at turn start to detect a NEW run
 *                       beginning after a stop (⇒ not yet complete).
 * - `lastStoppedAtMs` — wall-clock ms of the most recent true→false edge.
 */
export interface CopilotRunningState {
  attrPresent: boolean;
  runningNow: boolean | null;
  sawRunningTrue: boolean;
  runStartCount: number;
  lastStoppedAtMs: number;
}

/**
 * Read the page-side `__hk_copilotRunning` lifecycle summary. Returns the
 * "attribute absent / never observed" shape if the global hasn't been
 * seeded (pre-navigation, or a page where `attachSseInterceptor` never
 * ran) or if the `evaluate` itself throws — both are equivalent to "no
 * trustworthy DOM run-signal available" from the gate's vantage, which
 * routes it to the SSE-counter fallback.
 */
async function readCopilotRunning(page: Page): Promise<CopilotRunningState> {
  const absent: CopilotRunningState = {
    attrPresent: false,
    runningNow: null,
    sawRunningTrue: false,
    runStartCount: 0,
    lastStoppedAtMs: 0,
  };
  try {
    const raw = await page.evaluate(
      () =>
        (
          globalThis as unknown as {
            __hk_copilotRunning?: {
              attrPresent?: boolean;
              runningNow?: boolean | null;
              sawRunningTrue?: boolean;
              runStartCount?: number;
              lastStoppedAtMs?: number;
            };
          }
        ).__hk_copilotRunning ?? null,
    );
    if (raw === null || typeof raw !== "object") return absent;
    return {
      attrPresent: raw.attrPresent === true,
      runningNow:
        raw.runningNow === true
          ? true
          : raw.runningNow === false
            ? false
            : null,
      sawRunningTrue: raw.sawRunningTrue === true,
      runStartCount:
        typeof raw.runStartCount === "number" ? raw.runStartCount : 0,
      lastStoppedAtMs:
        typeof raw.lastStoppedAtMs === "number" ? raw.lastStoppedAtMs : 0,
    };
  } catch {
    return absent;
  }
}

/**
 * Block until ALL THREE of the following are true for turn `turnIndex`:
 *   1. SSE:  window.__hk_runsFinished >= turnIndex
 *   2. DOM:  the bubble at bubbleIndex = turnIndex - 1 exists under the
 *            shared cascade (countAssistantMessages > turnIndex - 1)
 *   3. TEXT: that bubble's textContent is non-empty AND has been stable
 *            for settleMs across consecutive polls
 *
 * AND, as a pre-conjunct fast-fail guard: if the `copilot-error-banner`
 * is observed VISIBLE for 2 consecutive polls (debounced — a single-poll
 * flicker is ignored) AND no response has yet been produced for this turn
 * (the DOM bubble for this turnIndex isn't there yet, so the assistant
 * hasn't streamed), the primitive short-circuits with `BannerVisibleError`
 * instead of burning the full `timeoutMs`. The runner translates that to
 * `AssistantErroredError` so #5142's fast-fail surface persists.
 *
 * Throws `TurnNotCompleteError` when any conjunct fails to converge
 * inside `timeoutMs`. The reason field is classified by the post-loop
 * read with precedence sse-missing > dom-missing > text-unstable, so
 * the operator sees the earliest-failing signal in the message.
 */
export async function waitForTurnComplete(
  opts: WaitForTurnCompleteOpts,
): Promise<WaitForTurnCompleteResult> {
  const { page, turnIndex, settleMs, timeoutMs } = opts;
  const baselineBannerText = opts.baselineBannerText ?? null;
  const surfaceReady = opts.surfaceReady ?? null;
  const pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  // Defect-2 sentinel: per-turn baseline count of assistant bubbles already
  // in the DOM BEFORE this turn submitted. The gate requires
  // `count > baselineCount` so a leftover bubble from a prior turn cannot
  // be misread as this turn's response. Defaults to `turnIndex - 1` for
  // backward compat with unit-test fakes that script count progressions
  // keyed to turn ordinals; production callers (the runner) snapshot the
  // real pre-submit count and pass it explicitly. See the multi-bubble
  // hotfix: multi-step agents (LangGraph, Mastra, CrewAI) emit 2-3+
  // bubbles per turn, so "turn N = N bubbles" no longer holds.
  const baselineCount = opts.baselineCount ?? turnIndex - 1;
  const startedAt = Date.now();
  // Track the last observed text per-poll so we can measure how long
  // the bubble has been stable. `null` is a distinct "no bubble yet"
  // state — different from the empty-string placeholder, so flipping
  // null -> "" resets the stability window (and "" -> "" stays stable
  // but the non-empty guard below keeps the gate closed).
  let lastText: string | null = null;
  let lastChangeAt = startedAt;
  // Banner fast-fail debounce: how many consecutive polls have seen
  // the banner in a DIFFERS-FROM-BASELINE state (visible AND its text
  // differs from `baselineBannerText`, or visible when baseline was
  // absent). We require 2 consecutive differs polls before short-circuiting
  // so a single-poll flicker (transient toast, render glitch, countdown
  // tick on a persisted banner) cannot spuriously fast-fail a turn that's
  // actually settling. A poll where the banner matches baseline (same
  // stale text) resets the counter — the banner is not a fresh error.
  let consecutiveBannerDiffersFromBaseline = 0;
  let lastBannerText = "";
  // Done-signal backstop ceiling. Defaults to `timeoutMs` (no early
  // backstop) when the caller doesn't opt in. Clamped to `timeoutMs` so a
  // misconfigured larger value can never push the backstop past the hard
  // ceiling. See `WaitForTurnCompleteOpts.maxTurnDurationMs`.
  const maxTurnDurationMs = Math.min(
    opts.maxTurnDurationMs ?? timeoutMs,
    timeoutMs,
  );
  // Multi-step toggle baseline: the page-side run-start count captured BEFORE
  // this turn submitted. A multi-step turn fires RUN_STARTED/RUN_FINISHED per
  // sub-run, toggling `data-copilot-running` false→true→false→true→…. By
  // comparing the LIVE `runStartCount` against this baseline we detect "a
  // NEW run started after the last stop" and refuse to complete on an
  // INTERMEDIATE false — completion requires running to have STOPPED and
  // STAYED stopped (no newer start) for the settle window.
  //
  // PREFER the caller's pre-send snapshot (`opts.baselineRunStartCount`). The
  // runner captures it BEFORE `sendTurnMessage` (mirroring `baselineCount`) so
  // a fast agent that fires RUN_STARTED before this function even runs cannot
  // poison the baseline. Falling back to an in-function read here would be
  // RACY on fast turns — the agent may already have started, making
  // `runStartCount > baselineRunStartCount` impossible and killing the PRIMARY
  // DOM signal. The in-function read is retained ONLY as the fallback for
  // callers (unit-test fakes) that don't pass the opt.
  const baselineRunStartCount =
    opts.baselineRunStartCount ??
    (await readCopilotRunning(page)).runStartCount;
  // STAYED-STOPPED quiescence tracking (the temporal guard the comments
  // promise and the gate must actually enforce). A bare `runningNow === false`
  // edge (`sawStopThisTurn`) is INSTANTANEOUS — true at ANY stop edge,
  // including the transient INTERMEDIATE stop between two sub-runs of a
  // multi-step turn. Completing on that edge false-greens the turn before its
  // final sub-run. We therefore require the stop to have PERSISTED — the same
  // `runStartCount` observed `runningNow === false` continuously for at least
  // `settleMs` (mirroring the text path's stability window) with NO newer
  // run-start. A new run-start (a later false→true edge bumping
  // `runStartCount`) resets this window, so an intermediate stop can never
  // satisfy it; only the FINAL stop that STAYS stopped does.
  //   - `stopStableSince`         : wall-clock ms the current stop edge was
  //                                 first observed (`null` when not stopped).
  //   - `stopStableRunStartCount` : the `runStartCount` value that stop edge
  //                                 belongs to; a change resets the window
  //                                 (a newer run started since).
  let stopStableSince: number | null = null;
  let stopStableRunStartCount = -1;
  // Records the last time we had NOT yet observed a trustworthy done-signal
  // while DOM+TEXT were satisfied — drives the `done-signal-missing`
  // backstop. `null` until DOM+TEXT first hold.
  const pwPage = page as unknown as PlaywrightPage;
  while (Date.now() - startedAt < timeoutMs) {
    const runsFinished = await readRunsFinished(page);
    const running = await readCopilotRunning(page);
    // Atomic single-evaluate read: `readCascadeStateLast` returns BOTH the
    // count and the text of the LAST bubble in the matched cascade tier in
    // ONE browser-side round-trip. The "last bubble" semantics is the
    // multi-bubble hotfix: multi-step agents (LangGraph, Mastra, CrewAI)
    // emit a tool-call bubble + tool-render bubble + final-text bubble
    // per turn; only the LAST bubble's scoped text (`.cpk\:prose` etc.)
    // is non-empty. The strict-index `turnIndex - 1` semantics this
    // replaces landed on intermediate tool-call bubbles whose scoped
    // selectors were empty forever → text-stable timeout across most
    // multi-step demos.
    const { count, text } = await readCascadeStateLast(pwPage);
    const now = Date.now();
    if (text !== lastText) {
      lastText = text;
      lastChangeAt = now;
    }
    // SSE fetch-counter signal (the legacy conjunct). FRAGILE: it relies on
    // the page-side fetch wrapper matching the runtime URL pattern + install
    // ordering + transport, which misses on variance → healthy demos
    // false-red. Retained as the FALLBACK done-signal for HEADLESS demos
    // (which never render `CopilotChatView`, so `data-copilot-running` is
    // absent), and as a SECONDARY confirmation alongside the DOM signal.
    const sseOk = runsFinished >= turnIndex;
    // PRIMARY done-signal edge — the `data-copilot-running` true→false
    // TRANSITION. Trustworthy ONLY when the attribute is present
    // (`attrPresent`); it is driven directly by the agent run lifecycle
    // (RUN_STARTED → true, RUN_FINISHED → false) and is transport-
    // independent (no fetch monkeypatch). We gate on the TRANSITION
    // (saw-running-then-stopped), NOT a bare `runningNow === false`, because
    // `false` is also the never-started baseline. Multi-step safety: we
    // additionally require that at least one run started THIS turn —
    // `runningNow === false` AND `sawRunningTrue` AND
    // `runStartCount > baselineRunStartCount` — so the latest edge for this
    // turn is a STOP. A subsequent false→true edge bumps `runStartCount` and
    // flips `runningNow` back to true, so this EDGE predicate goes false again
    // on an intermediate stop. CRUCIAL: this is only the INSTANTANEOUS edge —
    // it is true at ANY `runningNow===false` poll, including the transient
    // intermediate stop between sub-runs. Completion is NOT allowed to fire on
    // the bare edge; it requires the STAYED-STOPPED quiescence below.
    const sawStopThisTurn =
      running.sawRunningTrue &&
      running.runStartCount > baselineRunStartCount &&
      running.runningNow === false;
    // STAYED-STOPPED quiescence bookkeeping. Track that the stop has PERSISTED
    // for `settleMs` on the SAME `runStartCount` (no newer run started). A new
    // run-start (`runStartCount` changed) or a non-stop poll resets the
    // window, so an intermediate stop — immediately followed by a re-start
    // that bumps `runStartCount` — can never accumulate the window; only the
    // FINAL stop that stays stopped does. This is the temporal guard the
    // `data-copilot-running` done-signal needs so completion cannot fire on a
    // transient intermediate edge (mirroring the text path's `settleMs`).
    if (sawStopThisTurn) {
      if (running.runStartCount !== stopStableRunStartCount) {
        // First poll of a (new) stop edge for this run generation: arm the
        // window. A bumped `runStartCount` here means a newer run started and
        // then stopped — a DIFFERENT stop edge — so we re-arm from `now`.
        stopStableSince = now;
        stopStableRunStartCount = running.runStartCount;
      }
    } else {
      // Not stopped this poll (still running, re-started, or never started):
      // disarm — a stop must be CONTINUOUS across the settle window.
      stopStableSince = null;
      stopStableRunStartCount = -1;
    }
    const stopQuiescent =
      sawStopThisTurn &&
      stopStableSince !== null &&
      now - stopStableSince >= settleMs;
    const domSignalAvailable = running.attrPresent;
    // The DONE-signal. When the trustworthy DOM signal is AVAILABLE it is the
    // SOLE done-signal: the `data-copilot-running` true→false transition that
    // has STAYED stopped for the settle window (`stopQuiescent`) — and ONLY
    // that. Requiring quiescence (not the bare `sawStopThisTurn` edge) is what
    // prevents completion on a transient INTERMEDIATE stop between sub-runs —
    // the false-green the surface-mount path (which has no text-stability
    // window of its own) was exposed to. The fragile SSE fetch-counter must
    // NOT be able to satisfy the done-signal here, because on a MULTI-STEP
    // turn `sseOk = runsFinished >= turnIndex` goes true after the FIRST
    // sub-run's RUN_FINISHED and STAYS true for the rest of the turn — so an
    // `|| sseOk` disjunct would let that stale counter SOLELY drive completion
    // on an INTERMEDIATE stop (a new sub-run still to come). SSE is the
    // FALLBACK done-signal ONLY when the DOM signal is unavailable (headless
    // demos never render `CopilotChatView`, so `data-copilot-running` is
    // absent) — never an OR-trigger alongside a present DOM signal. (The SSE
    // counter is monotonic per turn and the headless path has no run-start
    // generations to distinguish, so it carries no transient-edge hazard.)
    const doneSignalOk = domSignalAvailable ? stopQuiescent : sseOk;
    // Defect-2 protection: a new bubble has appeared for THIS turn — not
    // just "any bubble exists". `count > baselineCount` rejects a leftover
    // bubble from a prior turn while accepting multi-step turns where >1
    // bubble appears (we still want the LAST of the new arrivals).
    const domOk = count > baselineCount;
    const textOk =
      text !== null && text.trim().length > 0 && now - lastChangeAt >= settleMs;
    // Third conjunct: text-stability by default, OR surface-mount when the
    // turn opted in via `completeOnMount` (surfaceReady != null). The
    // surface-mount path is checked ONLY once the done-signal + DOM hold, so
    // completion still requires the run to have finished and a new assistant
    // bubble to exist — we only swap WHAT the third signal is (rendered
    // surface vs. stable text). This is what makes the tool-rendered
    // A2UI-declarative demo (no assistant text bubble ever stabilises)
    // complete on its rendered dashboard instead of timing out.
    // ATOMICITY + EFFICIENCY: read the live surface state AT MOST ONCE per
    // poll and reuse the single value for BOTH the main-completion conjunct
    // (`thirdOk`) and the `done-signal-missing` backstop conjunct
    // (`thirdConjunctHeld`) below. Previously `surfaceReady(page)` — a real
    // `page.evaluate` DOM round-trip — was read once for `thirdOk` (gated on
    // `doneSignalOk && domOk` via short-circuit) AND again for
    // `thirdConjunctHeld`, so a poll where the done-signal + DOM held but the
    // surface had NOT yet mounted paid TWO round-trips and discarded the
    // second. The two reads
    // were also NON-ATOMIC: a surface that mounts BETWEEN them makes the two
    // conjuncts observe DIFFERENT live values within one iteration — a latent
    // disagreement hazard. A single read removes the wasted round-trip and
    // guarantees `thirdOk` and `thirdConjunctHeld` agree on the same value.
    // `null` (text-path) skips the read entirely.
    const surfaceMounted =
      surfaceReady !== null ? await surfaceReady(page) : false;
    const thirdOk =
      surfaceReady !== null ? doneSignalOk && domOk && surfaceMounted : textOk;
    if (doneSignalOk && domOk && thirdOk) {
      // bubbleIndex returned = last bubble in the matched tier at the
      // moment of return, so callers consuming the assertions ctx see the
      // same bubble whose text settled (or whose turn's surface mounted).
      return { bubbleIndex: count - 1, text: text ?? "" };
    }
    // DONE-SIGNAL BACKSTOP — catches the silent multi-step hang and REDS
    // it EARLY (at `maxTurnDurationMs`, well before the hard `timeoutMs`).
    // GATED on the trustworthy DOM signal being AVAILABLE (`domSignalAvailable`
    // / `attrPresent === true`) — see the DOM-SIGNAL GATE note below. When the
    // DOM signal is present and DOM + the third conjunct (text-stable /
    // surface-mounted) have held but the done-signal has NOT confirmed
    // (`!doneSignalOk` — the `data-copilot-running` true→false transition never
    // STAYED stopped) by `maxTurnDurationMs`, the bubble is painted and settled
    // yet the run never finished → throw RED rather than waiting out the full
    // `timeoutMs` (and rather than EVER false-greening on DOM+text alone). The
    // log/error below dumps BOTH raw counters for diagnosis. Classified
    // `done-signal-missing` so the operator sees the missing completion, not
    // the (present) text/surface. HEADLESS turns (`attrPresent === false`) are
    // NOT eligible for this early backstop — they have no authoritative signal
    // that can be "missing" and their lagging SSE counter must be allowed the
    // full `timeoutMs`; a genuinely-stuck headless turn reds at the hard
    // ceiling as `sse-missing` via the post-loop classifier. Reuses the single
    // per-poll `surfaceMounted` read (see ATOMICITY note above) so this
    // backstop conjunct and `thirdOk` agree on the same live surface value.
    //
    // RUNNING GUARD (`running.runningNow !== true`): the backstop must NEVER
    // red a turn that is still LEGITIMATELY running. A gen-UI turn can paint
    // its surface early while the run is still going; its stop edge may simply
    // land after `maxTurnDurationMs` but before the hard `timeoutMs`. Without
    // this guard such a turn false-REDS the moment `maxTurnDurationMs` elapses
    // even though it is healthily in flight. The backstop's job is the
    // painted-and-settled-but-finished-signal-MISSING case, where the run is
    // NOT currently running (`runningNow` is false, or absent → `null`). A
    // genuinely hung run whose `runningNow` is stuck `true` still reds — at
    // the hard `timeoutMs` via the post-loop classifier, not here.
    //
    // ARMING-STOP GUARD (`stopStableSince === null`): once a stop edge has
    // been observed it is ARMING toward quiescence — the very next poll(s) may
    // satisfy the `settleMs` STAYED-STOPPED window and COMPLETE the turn. If
    // `maxTurnDurationMs` happens to have already elapsed while the run was
    // still in flight, the run's stop edge lands AFTER the backstop deadline;
    // without this guard the backstop would red on the FIRST stopped poll,
    // before the quiescence window (`settleMs`) could be satisfied — racing
    // the legitimate completion it would otherwise produce one poll later. We
    // therefore defer the backstop while a stop edge is arming. A genuine hang
    // never arms a stop (`sawStopThisTurn` stays false → `stopStableSince`
    // stays `null`), so the backstop still reds it.
    //
    // DOM-SIGNAL GATE (`domSignalAvailable` / `running.attrPresent === true`):
    // the EARLY (`maxTurnDurationMs`) backstop applies ONLY when the
    // trustworthy DOM run-signal is AVAILABLE. With the DOM signal present,
    // `!doneSignalOk` means the `data-copilot-running` true→false transition we
    // SHOULD have seen has not arrived — a meaningful "the run lifecycle says
    // there should be a transition but there isn't" hang signal — so redding
    // early (rather than waiting out the full `timeoutMs`) is correct. For
    // HEADLESS turns (`attrPresent === false`: no `CopilotChatView`, so
    // `data-copilot-running` is absent) there is NO authoritative done-signal
    // that can be "missing"; the SOLE signal is the fragile SSE fetch-counter,
    // which the comments above document as prone to LAGGING. Early-redding a
    // healthy-but-lagging headless turn at `maxTurnDurationMs` (≈0.6×timeoutMs)
    // is a FALSE-RED on the exact fragile-SSE mode this PR exists to eliminate
    // — origin/main (no backstop) let such a turn run to the full timeout, by
    // which point the counter usually catches up (→ green). Both of the guards
    // above are INERT for headless (`runningNow` is `null`, never `true`;
    // `sawRunningTrue` is false so `stopStableSince` stays `null`), so without
    // this gate the early backstop would fire on every painted+settled headless
    // turn whose SSE counter merely lagged. A GENUINELY-stuck headless turn
    // (counter never catches up) still REDS — at the hard `timeoutMs` via the
    // post-loop classifier as `sse-missing`, exactly as origin/main did.
    const thirdConjunctHeld = surfaceReady !== null ? surfaceMounted : textOk;
    if (
      domSignalAvailable &&
      !doneSignalOk &&
      running.runningNow !== true &&
      stopStableSince === null &&
      domOk &&
      thirdConjunctHeld &&
      now - startedAt >= maxTurnDurationMs
    ) {
      console.warn(
        formatCvdiag({
          component: "conversation-runner",
          boundary: "inbound",
          status: "error",
          error: `done-signal-missing backstop: turn ${turnIndex} bubble painted + settled but neither data-copilot-running transition nor SSE counter confirmed within ${maxTurnDurationMs}ms (attrPresent=${running.attrPresent}, runningNow=${String(running.runningNow)}, sawRunningTrue=${running.sawRunningTrue}, runStartCount=${running.runStartCount}, baselineRunStartCount=${baselineRunStartCount}, runsFinished=${runsFinished})`,
        }),
      );
      throw new TurnNotCompleteError(
        "done-signal-missing",
        turnIndex,
        now - startedAt,
        `waitForTurnComplete: turn ${turnIndex} bubble settled but no done-signal (data-copilot-running transition or SSE counter) confirmed within maxTurnDurationMs=${maxTurnDurationMs}ms (reason=done-signal-missing, attrPresent=${running.attrPresent}, runningNow=${String(running.runningNow)}, runStartCount=${running.runStartCount}, runsFinished=${runsFinished}, count=${count})`,
      );
    }
    // Pre-conjunct banner fast-fail guard. We ONLY fire fast-fail when the
    // assistant hasn't yet produced a response for THIS turn (domOk =
    // false) — a banner alongside a real response is success-in-flight and
    // must not trip fast-fail. The 2-consecutive-differs-from-baseline
    // debounce gates a single-poll flicker AND a stale same-text persisted
    // banner. A banner matching baseline (same stale text) resets the
    // counter so it cannot accumulate a spurious fast-fail. `unreadable`
    // also resets (we don't know the banner state, so we can't honestly
    // count this poll as differing).
    if (!domOk) {
      const banner = await readErrorBanner(page);
      if (banner.state === "visible") {
        // "Differs from baseline" = (a) baseline was absent and we now see
        // a banner, OR (b) baseline was visible but with a different text.
        const differsFromBaseline =
          baselineBannerText === null || banner.text !== baselineBannerText;
        if (differsFromBaseline) {
          consecutiveBannerDiffersFromBaseline += 1;
          lastBannerText = banner.text;
          if (consecutiveBannerDiffersFromBaseline >= 2) {
            throw new BannerVisibleError(lastBannerText);
          }
        } else {
          // Banner visible but identical to baseline — a stale persisted
          // banner from a prior turn. NOT a fresh error signal; reset the
          // debounce so a later flicker on top of the stale text still
          // needs 2 consecutive differs polls to fire.
          consecutiveBannerDiffersFromBaseline = 0;
        }
      } else {
        // Either `absent` or `unreadable` — reset the debounce. We don't
        // treat `unreadable` as "still differs" because that would let a
        // single transient page.evaluate throw arm fast-fail with a stale
        // last-seen banner text we can't trust.
        consecutiveBannerDiffersFromBaseline = 0;
      }
    } else {
      // Success-in-flight (assistant has produced a response this turn):
      // the banner is now ignored — disarm the debounce so a late banner
      // does not race the settle path.
      consecutiveBannerDiffersFromBaseline = 0;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  // Re-read the final state to classify the failure. We do NOT reuse
  // the loop's last-seen snapshot — a race where the world settled
  // exactly between the last poll and the deadline should classify as
  // "we didn't see it in time", which the final read reproduces faithfully.
  const runsFinishedFinal = await readRunsFinished(page);
  const runningFinal = await readCopilotRunning(page);
  const countFinal = await countAssistantMessages(pwPage);
  // Recompute the loop's done-signal predicate at the final read so the
  // classifier agrees with the gate: with the DOM signal available the
  // done-signal is SOLELY "saw a stop THIS turn" (the trustworthy DOM
  // transition); the fragile SSE counter is NOT an OR-trigger here (it would
  // false-green an intermediate multi-step stop — see the loop predicate).
  // Headless (DOM signal absent) falls back to the SSE counter alone.
  const sawStopFinal =
    runningFinal.sawRunningTrue &&
    runningFinal.runStartCount > baselineRunStartCount &&
    runningFinal.runningNow === false;
  const doneSignalOkFinal = runningFinal.attrPresent
    ? sawStopFinal
    : runsFinishedFinal >= turnIndex;
  const domOkFinal = countFinal > baselineCount;
  // Precedence: blame the earliest signal that hadn't arrived. The blamed
  // reason differs by whether the trustworthy DOM run-signal was available.
  //
  //   1. No new bubble for this turn (`!domOkFinal`):
  //        - HEADLESS (attribute absent): the legacy SSE-counter conjunct is
  //          the only done-signal; if it never caught up, blame `sse-missing`
  //          (preserves the pre-fix headless classification + operator
  //          log-greps); otherwise `dom-missing`.
  //        - DOM-signal present: `dom-missing` (nothing rendered).
  //   2. A bubble rendered (`domOkFinal`) but the done-signal never confirmed
  //      (`!doneSignalOkFinal`):
  //        - DOM-signal present: `done-signal-missing` — the
  //          `data-copilot-running` true→false transition never fired (the
  //          SOLE done-signal when the DOM signal is available). This is the
  //          silent-hang case the backstop reds. The SSE counter is NOT
  //          consulted here: with the DOM signal present a bare missing SSE
  //          counter is never blamed as `sse-missing` (that WAS the false-red),
  //          and a PRESENT-but-stale SSE counter must not green an
  //          intermediate multi-step stop — both fold into the DOM-transition
  //          decision, classified `done-signal-missing`.
  //        - HEADLESS: the SSE counter is the sole done-signal; a missing one
  //          stays `sse-missing` (legacy semantics — the headless path has no
  //          DOM transition to fold into `done-signal-missing`).
  //   3. The done-signal DID confirm but the third conjunct never settled →
  //      `surface-missing` (surface-mount mode) / `text-unstable`.
  const reason: TurnNotCompleteError["reason"] = !domOkFinal
    ? !runningFinal.attrPresent && runsFinishedFinal < turnIndex
      ? "sse-missing"
      : "dom-missing"
    : !doneSignalOkFinal
      ? runningFinal.attrPresent
        ? "done-signal-missing"
        : "sse-missing"
      : surfaceReady !== null
        ? "surface-missing"
        : "text-unstable";
  throw new TurnNotCompleteError(
    reason,
    turnIndex,
    Date.now() - startedAt,
    `waitForTurnComplete: turn ${turnIndex} did not complete within ${timeoutMs}ms (reason=${reason}, runsFinished=${runsFinishedFinal}, count=${countFinal}, attrPresent=${runningFinal.attrPresent}, runningNow=${String(runningFinal.runningNow)}, runStartCount=${runningFinal.runStartCount})`,
  );
}
