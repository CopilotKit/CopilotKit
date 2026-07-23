import { describe, it, expect, vi } from "vitest";
import {
  runConversation,
  fillAndVerifySend,
  readUserMessageCount,
  waitForContentAndSend,
  readErrorBanner,
  AssistantErroredError,
  waitForTurnComplete,
  TurnNotCompleteError,
} from "./conversation-runner.js";
import type {
  ConversationTurn,
  Page,
  CopilotRunningState,
} from "./conversation-runner.js";

/**
 * Unit tests for the D5 conversation runner helper. Page is a structural
 * minimal surface (NOT the real playwright Page) so tests can inject
 * scripted fakes without spinning up chromium. Mirrors the e2e-smoke
 * driver's testing strategy.
 *
 * The runner's "assistant settled" detection polls the assistant-message
 * DOM node count (read via `page.evaluate`). Tests script `evaluate` to
 * return a deterministic sequence of counts: stability is reached once
 * the same value repeats across a quiet window of `assistantSettleMs`.
 *
 * To keep tests deterministic and fast we set `assistantSettleMs` to a
 * small value (50 ms) so the runner's real-timer polling loop completes
 * quickly. These tests use REAL timers throughout (no `vi.useFakeTimers`);
 * scripted `evaluate` count sequences — not clock manipulation — drive the
 * settle and fast-fail paths deterministically. Multi-turn and multi-poll
 * tests carry an explicit generous per-test timeout (third `it` arg) so
 * their cumulative real-sleep cost cannot collide with vitest's 5000 ms
 * default on a loaded CI runner.
 */

interface PageScript {
  // Scripted return values for `page.evaluate(...)`. Each invocation pulls
  // the next value from the queue; if the queue is exhausted the last
  // value repeats forever (so a "stable" tail can be modelled trivially).
  evaluateValues?: number[];
  // Optional override for `page.evaluate` so tests can spy on its
  // semantics directly when they need to.
  evaluate?: (fn: () => unknown, arg?: unknown) => Promise<unknown>;
  // Errors to throw on individual page-API calls.
  throwOnFill?: Error;
  throwOnPress?: Error;
  // Recorded inputs the runner sent; tests assert on these.
  recorded?: { fills: string[]; presses: string[] };
  // Scripted user-message counts for the send-verification retry loop.
  // When provided, `page.evaluate` checks whether the evaluate function
  // body references user-message selectors and returns from this queue
  // instead of the main `evaluateValues` queue.
  userMessageValues?: number[];
  // Scripted return values for `page.inputValue(...)`. Each invocation
  // pulls the next value from the queue; last value repeats forever.
  // Used by skipFill tests to simulate async textarea population.
  inputValues?: string[];
  // Scripted return values for the error-banner visibility probe (reads
  // that reference `copilot-error-banner`). Each invocation pulls the
  // next value; once exhausted the last value repeats forever. A `true`
  // (or `{ visible: true }`) means the
  // `[data-testid="copilot-error-banner"]` is visible.
  // Used by fast-fail tests to simulate the chat error banner appearing
  // mid-settle without any new assistant message arriving. Each entry may
  // be a bare boolean (text defaults to "Something went wrong" when
  // visible) OR an object carrying explicit `text`, so tests can model a
  // banner whose TEXT changes across polls (a re-armed new/changed error)
  // — not just its visibility.
  errorBannerValues?: Array<boolean | { visible: boolean; text?: string }>;
  // When true, the fake exposes a `page.reload()` that RE-SEEDS the
  // assistant-message and error-banner queues from their original scripted
  // values — modelling a real Playwright reload tearing down and re-painting
  // the DOM. Used by turn-1 fast-fail tests to verify a SUSTAINED real banner
  // still fast-fails on the bounded cold-start retry's 2nd attempt (the banner
  // re-paints fresh after the reload, so the 2nd settle re-snapshots a clean
  // baseline and fast-fails again — #5142 stays intact across the retry).
  reloadReplaysQueues?: boolean;
  // Scripted generator for the CopilotKit v2 run-lifecycle summary
  // (`window.__hk_copilotRunning`) that `waitForTurnComplete` reads as its
  // PRIMARY done-signal. Called once per `__hk_copilotRunning` evaluate; the
  // generator owns its own poll-to-poll progression (e.g. attribute absent →
  // running true → running false). When omitted, the fake returns the
  // "attribute absent" shape so the gate falls back to the SSE counter —
  // every pre-existing count-driven test keeps its original semantics.
  copilotRunning?: () => {
    attrPresent: boolean;
    runningNow: boolean | null;
    sawRunningTrue: boolean;
    runStartCount: number;
    lastStoppedAtMs: number;
  };
}

/**
 * Wrap an evaluate function so that user-message reads (from
 * `readUserMessageCount`) return a monotonically increasing count —
 * simulating that the user message appeared on first try after each
 * fill+press. This prevents `fillAndVerifySend` from burning 2s×3
 * retries in tests that don't care about the send-verification loop.
 */
function wrapEvaluateForUserMessages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inner: (...args: any[]) => Promise<any>,
): Page["evaluate"] {
  let userCalls = 0;
  // Track the most recent assistant-count value returned by `inner` so the
  // post-cutover `waitForTurnComplete` primitive's auxiliary reads (SSE
  // run-finished counter, bubble-text-at-index) can be synthesised from the
  // SAME scripted count progression the test author provided. This mirrors
  // `makePage`'s branch dispatch so tests that use this helper see the same
  // shape from every read branch as tests that use `makePage` directly.
  let latestCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async function (this: unknown, fn: (...a: any[]) => unknown) {
    // Playwright's real Page accepts (fn, arg); the structural Page
    // surface erases the second arg. Grab it via `arguments` so any
    // probe that passes a runtime arg (e.g. `findAssistantBubbleAt`'s
    // bubbleIndex) still reaches the inner / synthesised branches.
    // eslint-disable-next-line prefer-rest-params
    const argRuntime = (arguments as unknown as IArguments)[1] as
      | number
      | undefined;
    const body = fn.toString();
    if (body.includes("copilot-user-message")) {
      return userCalls++ as never;
    }
    // Error-banner visibility probe: these helpers never simulate a
    // banner, so return the runner-expected `{ visible: false }` shape
    // explicitly. Previously this read fell through to `inner(fn)`, which
    // returns an assistant-count NUMBER — the runner only worked because
    // `(someNumber).visible` is `undefined` (falsy). Returning the real
    // shape exercises the genuine "no banner" path instead of relying on
    // that accident.
    if (body.includes("copilot-error-banner")) {
      return { visible: false } as never;
    }
    // SSE run-finished counter read (`waitForTurnComplete` conjunct 1).
    // Synthesised from the latest observed assistant count: whenever the
    // assistant DOM has N bubbles, the server must have flushed N
    // RUN_FINISHED events. This keeps existing single-queue inner scripts
    // (0 → 1 stable) satisfying the SSE conjunct without per-test
    // augmentation — exact parity with `makePage`'s `__hk_runsFinished`
    // branch.
    if (body.includes("__hk_runsFinished")) {
      return latestCount as never;
    }
    // CopilotKit v2 run-lifecycle summary (`__hk_copilotRunning`) — the
    // PRIMARY done-signal. These user-message helpers never simulate the
    // chat-view attribute, so return the "attribute absent" shape; the gate
    // then falls back to the synthesised SSE counter above (unchanged
    // semantics for every test routed through this helper).
    if (body.includes("__hk_copilotRunning")) {
      return {
        attrPresent: false,
        runningNow: null,
        sawRunningTrue: false,
        runStartCount: 0,
        lastStoppedAtMs: 0,
      } as never;
    }
    // Atomic cascade-state read (`readCascadeState`): returns BOTH the
    // count and the indexed text from the SAME cascade tier in ONE
    // round-trip. Routed BEFORE the legacy text-only branch because the
    // closure body matches BOTH dispatch heuristics (`querySelectorAll`
    // + `textContent`); the distinguishing substring is the literal
    // `{ count` the closure uses to construct its return object. We
    // forward to `inner` to drain the count progression the test author
    // scripted, then synthesise the text from the resulting latestCount.
    if (
      body.includes("querySelectorAll") &&
      body.includes("textContent") &&
      body.includes("{ count")
    ) {
      // eslint-disable-next-line prefer-rest-params
      const innerArgsCascade = Array.from(arguments as unknown as IArguments);
      const innerResult = (await (
        inner as (...a: unknown[]) => Promise<unknown>
      )(...innerArgsCascade)) as unknown;
      if (typeof innerResult === "number") {
        latestCount = innerResult;
      }
      const idx = argRuntime ?? 0;
      const text =
        idx < 0 || idx >= latestCount
          ? null
          : `assistant-bubble-text-${latestCount}`;
      return { count: latestCount, text } as never;
    }
    // Assistant-bubble TEXT read (`findAssistantBubbleAt`). Mirror
    // `makePage`'s text branch: return a non-empty placeholder whenever
    // a bubble at the requested index exists (latestCount surpasses idx),
    // null otherwise. The text value tracks the latest count so the
    // text-stable conjunct of `waitForTurnComplete` holds as soon as the
    // count stops changing.
    if (body.includes("querySelectorAll") && body.includes("textContent")) {
      const idx = argRuntime ?? 0;
      if (idx < 0 || idx >= latestCount) return null as never;
      return `assistant-bubble-text-${latestCount}` as never;
    }
    // Default branch: forward to the inner script (and the runtime arg,
    // so a script that needs it isn't silently passed `undefined`). Cache
    // the result as the new `latestCount` for the synthesised SSE/text
    // branches above.
    // eslint-disable-next-line prefer-rest-params
    const innerArgs = Array.from(arguments as unknown as IArguments);
    const result = (await (inner as (...a: unknown[]) => Promise<unknown>)(
      ...innerArgs,
    )) as unknown;
    if (typeof result === "number") {
      latestCount = result;
    }
    return result as never;
  } as Page["evaluate"];
}

/**
 * Mirror the text-shaping `readErrorBanner` applies to a banner's
 * `textContent` before the SUT sees it. The SUT compares this value across
 * polls (`textChanged`) to re-arm fast-fail. Keeping this in one place lets
 * the fake track the production contract exactly: when `readErrorBanner`
 * returns the FULL text (and truncates only the thrown message), this returns
 * the full text too.
 */
function shapeBannerProbeText(text: string): string {
  // `readErrorBanner` returns the FULL `textContent` — truncation is applied
  // downstream only to the thrown message (`BANNER_MESSAGE_MAX_LENGTH`), never
  // to the value compared across polls. The fake mirrors that contract.
  return text;
}

/**
 * Detect whether an `evaluate` callback body is the atomic `readCascadeState`
 * closure. The production closure builds a `{ count, text }` object and so its
 * stringified body contains the literal `{ count` — distinct from the legacy
 * count-only and text-only branches whose bodies don't construct that object.
 *
 * Hand-rolled `page.evaluate` fakes use this to return the `{ count, text }`
 * shape instead of a raw number when the runner's `waitForTurnComplete` is
 * making its single atomic cascade read.
 */
function isReadCascadeStateBody(body: string): boolean {
  return (
    body.includes("querySelectorAll") &&
    body.includes("textContent") &&
    body.includes("{ count")
  );
}

/**
 * Synthesise a cascade-state result from a scalar count, mirroring the shape
 * `readCascadeState` returns. Hand-rolled fakes use this to translate their
 * legacy count-only return value into the atomic `{ count, text }` shape.
 */
function cascadeStateOf(
  count: number,
  idx: number,
): { count: number; text: string | null } {
  const text =
    idx < 0 || idx >= count ? null : `assistant-bubble-text-${count}`;
  return { count, text };
}

function makePage(script: PageScript = {}): Page {
  const queue = [...(script.evaluateValues ?? [])];
  const userQueue = [...(script.userMessageValues ?? [])];
  const inputQueue = [...(script.inputValues ?? [])];
  const errorBannerQueue = [...(script.errorBannerValues ?? [])];
  // Auto-succeed counter: first user-message read = 0 (baseline),
  // subsequent reads = 1 (growth detected → verify loop succeeds).
  let autoUserCalls = 0;
  // Track the most recent assistant-count value drained from the queue.
  // The post-cutover `waitForTurnComplete` primitive makes THREE reads
  // per poll iteration (SSE counter, count, text). Tests script
  // `evaluateValues` as count progressions; the SSE counter is
  // auto-derived from the latest count (any time the assistant DOM has
  // grown to N bubbles, the server must have flushed N RUN_FINISHED
  // events) and the text branch returns a non-empty placeholder
  // whenever the count surpasses the requested index. This keeps
  // existing single-queue test scripts working without per-test
  // SSE/text augmentation.
  let latestCount = 0;
  return {
    async waitForSelector() {
      // No-op — the runner uses this only to confirm the chat input exists.
    },
    async fill(_selector, value) {
      if (script.throwOnFill) throw script.throwOnFill;
      script.recorded?.fills.push(value);
    },
    async press(_selector, _key) {
      if (script.throwOnPress) throw script.throwOnPress;
      script.recorded?.presses.push(_key);
    },
    async evaluate(fn: () => unknown) {
      // The structural Page surface declares evaluate as single-arg, but
      // Playwright's real Page accepts (fn, arg) — `findAssistantBubbleAt`
      // calls it with a bubbleIndex as the second arg. We grab the optional
      // second runtime arg via `arguments` since the structural signature
      // erases it.
      // eslint-disable-next-line prefer-rest-params
      const argRuntime = (arguments as unknown as IArguments)[1] as
        | number
        | undefined;
      if (script.evaluate) return script.evaluate(fn, argRuntime) as never;

      // Detect whether the evaluate call is reading user messages or
      // assistant messages by inspecting the function body. The
      // readUserMessageCount function references "copilot-user-message"
      // while countAssistantMessages references "copilot-assistant-message".
      const fnBody = fn.toString();
      // SSE run-finished counter read (`waitForTurnComplete` conjunct
      // 1). The page-side counter is exposed by attachSseInterceptor in
      // production; in this unit test we synthesise it as the latest
      // observed assistant count so any scripted count progression
      // (0 → 1 → 1 → …) trivially satisfies "SSE caught up to turn N"
      // whenever the corresponding bubble exists in the DOM.
      if (fnBody.includes("__hk_runsFinished")) {
        return latestCount as never;
      }
      // CopilotKit v2 run-lifecycle summary (`__hk_copilotRunning`). The
      // post-fix `waitForTurnComplete` reads this as its PRIMARY done-signal.
      // Tests opt in by scripting `copilotRunning` (a generator keyed to the
      // running-attribute state); when unscripted we return the
      // "attribute absent" shape so the gate falls back to the SSE counter —
      // exactly the behaviour every pre-existing count-based test relies on.
      if (fnBody.includes("__hk_copilotRunning")) {
        if (script.copilotRunning) {
          return script.copilotRunning() as never;
        }
        return {
          attrPresent: false,
          runningNow: null,
          sawRunningTrue: false,
          runStartCount: 0,
          lastStoppedAtMs: 0,
        } as never;
      }
      // Error-banner visibility probe references "copilot-error-banner".
      // Routed before the message-count branches so it gets its own
      // scripted queue. Defaults to `false` (no banner) when unscripted
      // so existing tests are unaffected.
      if (fnBody.includes("copilot-error-banner")) {
        const entry =
          errorBannerQueue.length === 0
            ? false
            : errorBannerQueue.length === 1
              ? errorBannerQueue[0]!
              : errorBannerQueue.shift()!;
        const visible = typeof entry === "boolean" ? entry : entry.visible;
        const text =
          typeof entry === "boolean" ? "Something went wrong" : entry.text;
        // Faithfully model the browser-side read contract of
        // `readErrorBanner`: the probe returns the banner's `textContent` and
        // the SUT uses that value for the cross-poll `textChanged`
        // comparison. The fake mirrors whatever shape `readErrorBanner`
        // yields — see `shapeBannerProbeText` above.
        const resolved = visible ? (text ?? "Something went wrong") : undefined;
        return {
          visible,
          ...(visible ? { text: shapeBannerProbeText(resolved!) } : {}),
        } as never;
      }
      if (fnBody.includes("copilot-user-message")) {
        if (userQueue.length > 0) {
          if (userQueue.length === 1) return userQueue[0]! as never;
          return userQueue.shift()! as never;
        }
        // No explicit user-message script — auto-succeed so the
        // verify loop doesn't burn time in tests that only care about
        // assistant-message settling. Returns a monotonically
        // increasing count so every fillAndVerifySend call sees
        // growth past its baseline on the first poll.
        return autoUserCalls++ as never;
      }

      // Atomic cascade-state read (`readCascadeState`): returns BOTH the
      // count and the indexed text from the SAME cascade tier in ONE
      // round-trip. Routed BEFORE the legacy text-only branch because the
      // closure body matches BOTH dispatch heuristics (`querySelectorAll`
      // + `textContent`); the distinguishing substring is the literal
      // `{ count` the closure uses to construct its return object.
      //
      // The drain happens INLINE here (rather than at the default-branch
      // tail like the legacy 3-call flow) because the post-cutover
      // `waitForTurnComplete` makes only TWO reads per poll (SSE counter
      // + cascade-state), so this is the call that must advance the
      // scripted count progression for each poll.
      if (
        fnBody.includes("querySelectorAll") &&
        fnBody.includes("textContent") &&
        fnBody.includes("{ count")
      ) {
        let drained: number;
        if (queue.length === 0) {
          drained = 0;
        } else if (queue.length === 1) {
          drained = queue[0]!;
        } else {
          drained = queue.shift()!;
        }
        latestCount = drained;
        const idx = argRuntime ?? 0;
        const text =
          idx < 0 || idx >= latestCount
            ? null
            : `assistant-bubble-text-${latestCount}`;
        return { count: latestCount, text } as never;
      }
      // Assistant-bubble TEXT read (`findAssistantBubbleAt`). The
      // production helper passes a 0-based bubbleIndex as the second
      // arg to page.evaluate; the playwright Page surface accepts
      // (fn, arg) — both reach this fake via the rest param. Return
      // a non-empty placeholder whenever a bubble at that index exists
      // (i.e. latestCount surpasses the requested index), null
      // otherwise — matches the production cascade's null-when-index-
      // out-of-range behaviour. The text value mirrors the latest count
      // so the `waitForTurnComplete` text-stable conjunct holds as soon
      // as the count stops changing.
      if (
        fnBody.includes("querySelectorAll") &&
        fnBody.includes("textContent")
      ) {
        const idx = argRuntime ?? 0;
        if (idx < 0 || idx >= latestCount) return null as never;
        return `assistant-bubble-text-${latestCount}` as never;
      }

      // Drain one value per call. Once exhausted, freeze on the last
      // value so any post-script poll sees the steady-state count
      // (matches a real assistant message that has finished streaming).
      let value: number;
      if (queue.length === 0) {
        value = 0;
      } else if (queue.length === 1) {
        value = queue[0]!;
      } else {
        value = queue.shift()!;
      }
      latestCount = value;
      return value as never;
    },
    // inputValue is only provided when the script includes inputValues,
    // mirroring the optional nature of the Page interface member.
    ...(script.inputValues
      ? {
          async inputValue(_selector: string): Promise<string> {
            if (inputQueue.length === 0) return "";
            if (inputQueue.length === 1) return inputQueue[0]!;
            return inputQueue.shift()!;
          },
        }
      : {}),
    // reload is only provided when the script opts in. It re-seeds the
    // assistant-message and error-banner queues from their original scripted
    // values so the post-reload settle replays the same scripted sequence —
    // modelling a real DOM teardown + re-paint. Auto-user-message growth is
    // reset too so the re-send's fillAndVerifySend sees a fresh user bubble.
    ...(script.reloadReplaysQueues
      ? {
          async reload(): Promise<void> {
            queue.length = 0;
            queue.push(...(script.evaluateValues ?? []));
            errorBannerQueue.length = 0;
            errorBannerQueue.push(...(script.errorBannerValues ?? []));
            autoUserCalls = 0;
          },
        }
      : {}),
  };
}

describe("runConversation", () => {
  it("keeps prompts, assistant content, and assertion payloads out of CI logs", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const privatePrompt = "PRIVATE_PROMPT_DO_NOT_LOG";
    const privateAssertion = "PRIVATE_ASSERTION_PAYLOAD_DO_NOT_LOG";
    const privateAssistantText = "assistant-bubble-text-1";
    const page = makePage({
      evaluateValues: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
    });

    try {
      const result = await runConversation(
        page,
        [
          {
            input: privatePrompt,
            assertions: async () => {
              throw new Error(privateAssertion);
            },
          },
        ],
        { assistantSettleMs: 50 },
      );

      // The in-memory result retains the original error so the bounded matrix
      // classifier can identify the failure. Only operator-visible logs must
      // omit content-bearing values.
      expect(result.error).toBe(privateAssertion);
      const emitted = JSON.stringify([...debug.mock.calls, ...warn.mock.calls]);
      expect(emitted).not.toContain(privatePrompt);
      expect(emitted).not.toContain(privateAssistantText);
      expect(emitted).not.toContain(privateAssertion);
    } finally {
      debug.mockRestore();
      warn.mockRestore();
    }
  }, 10_000);

  it("happy path: 3 turns succeed and run assertions in order", async () => {
    const recorded = { fills: [] as string[], presses: [] as string[] };
    // Each turn must see the assistant-message count grow then stabilise.
    // The runner polls every ~50 ms; we give a short stable tail per turn.
    // Turn 1: count goes 0 → 1 → 1 (stable at 1 for one turn worth of polls)
    // Turn 2: 1 → 2 → 2
    // Turn 3: 2 → 3 → 3
    // Many repeats of the stable value cover any number of polls during
    // the settle window without the tests caring about exact timing.
    const page = makePage({
      evaluateValues: [
        0,
        0,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1, // turn 1 settle
        1,
        1,
        2,
        2,
        2,
        2,
        2,
        2,
        2,
        2, // turn 2 settle
        2,
        2,
        3,
        3,
        3,
        3,
        3,
        3,
        3,
        3, // turn 3 settle
      ],
      recorded,
    });

    const order: number[] = [];
    const turns: ConversationTurn[] = [
      {
        input: "first",
        assertions: async () => {
          order.push(1);
        },
      },
      {
        input: "second",
        assertions: async () => {
          order.push(2);
        },
      },
      {
        input: "third",
        assertions: async () => {
          order.push(3);
        },
      },
    ];

    const result = await runConversation(page, turns, {
      assistantSettleMs: 50,
    });

    expect(result.turns_completed).toBe(3);
    expect(result.total_turns).toBe(3);
    expect(result.failure_turn).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.turn_durations_ms).toHaveLength(3);
    expect(order).toEqual([1, 2, 3]);
    expect(recorded.fills).toEqual(["first", "second", "third"]);
    expect(recorded.presses).toEqual(["Enter", "Enter", "Enter"]);
    // 3 turns × real settle polling ≈ 3.5s locally; explicit generous
    // per-test timeout keeps it clear of vitest's 5000ms default on a
    // loaded CI runner.
  }, 20_000);

  it("turn-2 assertion failure: returns failure_turn=2 and error, stops further turns", async () => {
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      evaluateValues: [
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2,
        // turn 3 should never run
      ],
      recorded,
    });

    let turn3Ran = false;
    const turns: ConversationTurn[] = [
      { input: "first" },
      {
        input: "second",
        assertions: async () => {
          throw new Error("assertion x failed");
        },
      },
      {
        input: "third",
        assertions: async () => {
          turn3Ran = true;
        },
      },
    ];

    const result = await runConversation(page, turns, {
      assistantSettleMs: 50,
    });

    // Turn 1 completed; turn 2's assertion threw → failure_turn=2 but
    // turns_completed reflects only fully-successful turns, hence 1.
    expect(result.turns_completed).toBe(1);
    expect(result.total_turns).toBe(3);
    expect(result.failure_turn).toBe(2);
    expect(result.error).toContain("assertion x failed");
    // Spec: `turn_durations_ms.length === turns_completed`, so the failed
    // turn's duration is NOT recorded.
    expect(result.turn_durations_ms).toHaveLength(1);
    expect(turn3Ran).toBe(false);
    // The third input was never typed.
    expect(recorded.fills).toEqual(["first", "second"]);
    // Drives 2 turns through real settle polling (~2.1s locally); explicit
    // timeout keeps it clear of the 5000ms default on a loaded CI runner.
  }, 20_000);

  it("assistant never responds: turn fails with timeout error", async () => {
    const recorded = { fills: [] as string[], presses: [] as string[] };
    // evaluateValues empty → page.evaluate always returns 0 → no growth →
    // settle never sees a non-zero stable value (the runner treats
    // "stable at 0" as "no response yet" by waiting for a positive count
    // before considering the response complete).
    const page = makePage({ evaluateValues: [0], recorded });

    const turns: ConversationTurn[] = [
      { input: "hello", responseTimeoutMs: 200 },
    ];

    const result = await runConversation(page, turns, {
      assistantSettleMs: 50,
    });

    expect(result.turns_completed).toBe(0);
    expect(result.total_turns).toBe(1);
    expect(result.failure_turn).toBe(1);
    expect(result.error).toBeDefined();
    // `waitForTurnComplete` surfaces the failure as
    // "turn N did not complete within Xms (reason=…)" — the canonical
    // settle-deadline message. Either the historical "timeout" word or the
    // current "did not complete within" phrase satisfies the contract: the
    // assertion is "the runner timed out waiting for the assistant", not the
    // exact wording of the message.
    expect(result.error!.toLowerCase()).toMatch(
      /timeout|did not complete within/i,
    );
    // Failed turn's duration is not recorded (spec: length === turns_completed).
    expect(result.turn_durations_ms).toHaveLength(0);
  });

  it("fast-fails when the copilot-error-banner becomes visible and STAYS for 2+ polls mid-settle", async () => {
    // The turn submits but NO new assistant message ever arrives — the
    // assistant-message count stays pinned at the baseline (0). Without
    // the fast-fail path the runner would poll until the full
    // `responseTimeoutMs` (here 5000ms) expires and throw a generic
    // timeout. Instead, a FRESH error banner becomes visible mid-settle and
    // STAYS visible (not present at baseline → differs-from-baseline state).
    // Under the unified rule, ALL banner detection is debounced behind a
    // 2-consecutive-poll counter (no more immediate `isNewBanner` path), so
    // the banner must persist across 2 polls before the runner short-circuits
    // with a distinguished "chat errored" failure. The scripted queue keeps
    // the banner visible from poll2 onward (last value repeats), satisfying
    // the 2-consecutive-poll debounce.
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      // Assistant count never grows past baseline.
      evaluateValues: [0],
      // Banner NOT visible at baseline, then appears at poll2 and STAYS
      // (last value `true` repeats forever) → 2+ consecutive
      // differs-from-baseline polls → fast-fail under the unified debounce.
      errorBannerValues: [false, false, true],
      // This is turn 1, so the bounded cold-start retry fires once on the
      // fast-fail. The banner SURVIVES the reload (re-seeded queues re-paint
      // the same fresh banner) → the 2nd attempt fast-fails again and the
      // distinguished AssistantErroredError is re-thrown. #5142 stays intact.
      reloadReplaysQueues: true,
      recorded,
    });

    const start = Date.now();
    const result = await runConversation(
      page,
      [{ input: "trigger error", responseTimeoutMs: 5000 }],
      { assistantSettleMs: 50 },
    );
    const elapsed = Date.now() - start;

    expect(result.turns_completed).toBe(0);
    expect(result.total_turns).toBe(1);
    expect(result.failure_turn).toBe(1);
    expect(result.error).toBeDefined();
    // Distinguished error — NOT the generic "timeout" message. The runner
    // surfaces the thrown error's MESSAGE, which for a banner fast-fail is
    // an `AssistantErroredError`. Assert the exact distinguished marker AND
    // the scripted banner text (not merely the substring "error", which a
    // generic timeout would also contain). Comparing against a freshly
    // constructed `AssistantErroredError` message proves the runner threw
    // that error type with the banner text — the string IS its `.message`.
    expect(result.error).toBe(
      new AssistantErroredError("Something went wrong").message,
    );
    expect(result.error).toContain("copilot-error-banner visible");
    expect(result.error).toContain("Something went wrong");
    expect(result.error!.toLowerCase()).not.toContain("timeout");
    // Contract guard: the banner fast-fail path throws an
    // `AssistantErroredError` (an `Error` subclass) carrying this exact
    // message, so the driver can classify it distinctly from a timeout.
    const expected = new AssistantErroredError("Something went wrong");
    expect(expected).toBeInstanceOf(AssistantErroredError);
    expect(expected).toBeInstanceOf(Error);
    expect(result.error).toBe(expected.message);
    // The whole point: bail well before the 5000ms responseTimeout. The
    // bounded turn-1 cold-start retry adds a SECOND fast-fail cycle, so the
    // bound is 3000ms (two fast-fail cycles) — still far under the 5000ms
    // settle timeout, proving we never burned the full wall-clock.
    expect(elapsed).toBeLessThan(3000);
    // Failed turn's duration is not recorded.
    expect(result.turn_durations_ms).toHaveLength(0);
    // Real multi-poll settle loop; explicit timeout for CI headroom.
  }, 20_000);

  it("does NOT fast-fail on a stale banner whose text is UNCHANGED from baseline", async () => {
    // A banner that was visible BEFORE the turn was submitted (a stale
    // banner left over from a prior turn) whose TEXT never changes must
    // NOT be mistaken for this turn's error. CopilotKit error banners
    // persist across turns, so an unchanged same-text banner is the
    // expected steady state — only a NEW or text-CHANGED banner re-arms
    // the fast-fail. The assistant responds normally (count grows past
    // baseline and settles) → the turn must SUCCEED despite the
    // ever-present, same-text banner.
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      // Assistant count: baseline=0, then grows to 1 and stays → settles.
      evaluateValues: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
      // Banner visible the ENTIRE time with the SAME text, including at
      // baseline. Same text across polls ⇒ stale ⇒ must NOT fast-fail.
      errorBannerValues: [{ visible: true, text: "Old error" }],
      recorded,
    });

    const result = await runConversation(
      page,
      [{ input: "hello", responseTimeoutMs: 5000 }],
      { assistantSettleMs: 50 },
    );

    expect(result.turns_completed).toBe(1);
    expect(result.failure_turn).toBeUndefined();
    expect(result.error).toBeUndefined();
    // Real multi-poll settle loop; explicit timeout for CI headroom.
  }, 20_000);

  it("RE-ARMS fast-fail when a baseline banner's TEXT changes mid-settle (new error)", async () => {
    // Multi-turn regression: CopilotKit error banners persist across
    // turns, so a banner can ALREADY be visible at this turn's baseline
    // (a stale leftover from a prior errored turn). If a NEW error then
    // occurs this turn, the banner's TEXT changes — but NO new assistant
    // message arrives, so the count stays pinned at baseline. The old
    // boolean snapshot (`errorBannerAtBaseline`) disabled the ENTIRE
    // fast-fail path whenever a banner was present at baseline, so the
    // 2nd+ errored turn silently paid the full responseTimeout. The fix
    // snapshots the baseline banner TEXT and re-arms detection when the
    // visible banner's text DIFFERS from baseline — fast-failing on the
    // new error even though a stale banner was already up.
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      // Assistant count never grows past baseline (no new message).
      evaluateValues: [0],
      // Banner visible at baseline as "Old error" (stale), then its TEXT
      // changes to "New error" mid-settle (a fresh error this turn).
      errorBannerValues: [
        { visible: true, text: "Old error" },
        { visible: true, text: "Old error" },
        { visible: true, text: "New error" },
      ],
      // Turn 1 → the bounded cold-start retry fires on the fast-fail. The
      // re-seeded queues replay the same baseline-stale-then-changed sequence,
      // so the 2nd attempt re-arms and fast-fails on "New error" again. #5142
      // (and the baseline-text re-arm fix) stay intact across the retry.
      reloadReplaysQueues: true,
      recorded,
    });

    const start = Date.now();
    const result = await runConversation(
      page,
      [{ input: "trigger new error", responseTimeoutMs: 5000 }],
      { assistantSettleMs: 50 },
    );
    const elapsed = Date.now() - start;

    expect(result.turns_completed).toBe(0);
    expect(result.total_turns).toBe(1);
    expect(result.failure_turn).toBe(1);
    expect(result.error).toBeDefined();
    // Fast-failed on the NEW banner text, not the stale one.
    expect(result.error).toBe(new AssistantErroredError("New error").message);
    expect(result.error).toContain("copilot-error-banner visible");
    expect(result.error).toContain("New error");
    expect(result.error!.toLowerCase()).not.toContain("timeout");
    // Bailed well before the 5000ms responseTimeout — the whole point. The
    // bounded cold-start retry adds a 2nd fast-fail cycle, so the bound is
    // 3000ms (two cycles), still far under the 5000ms settle timeout.
    expect(elapsed).toBeLessThan(3000);
    expect(result.turn_durations_ms).toHaveLength(0);
    // Real multi-poll settle loop; explicit timeout for CI headroom.
  }, 20_000);

  it("does NOT fast-fail when a persisted banner's text FLICKERS for a single poll then reverts (succeeding turn)", async () => {
    // Finding 2 (streaming false-POSITIVE): a banner that is visible at
    // baseline (persisted from a prior turn) can have its text transiently
    // mutate mid-stream — a countdown tick, a momentary empty during a
    // re-render — while THIS turn is actually SUCCEEDING. An undebounced
    // `textChanged` check would fire a SPURIOUS `AssistantErroredError` on a
    // succeeding turn (a false RED, strictly worse than a slow-fail). The fix
    // debounces ONLY the text-changed path: a changed text must persist
    // across 2 consecutive polls before it fast-fails. A single-poll flicker
    // that reverts must NOT fast-fail, so the turn settles normally.
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      // Assistant count stays AT baseline (0) through the flicker poll so the
      // flicker is evaluated while no response has yet been produced —
      // exercising the real debounce-reset path, NOT the success-in-flight
      // disarm. THEN it grows to 1 and freezes so the turn settles AFTER the
      // flicker poll has been seen. `waitForTurnComplete` makes THREE
      // page.evaluate reads per poll: (1) the SSE counter
      // `window.__hk_runsFinished`, (2) `countAssistantMessages` (DOM count),
      // (3) `findAssistantBubbleAt(idx).textContent`. Only the count read
      // drains this scripted `evaluateValues` queue — the SSE counter is
      // synthesized from the latest observed count in the fake (so it tracks
      // the count trivially) and the text branch returns a non-empty
      // placeholder whenever the count surpasses the requested index. The
      // queue values therefore describe the SUCCESSIVE COUNT READS the fake
      // returns: poll1=0, poll2=0, poll3=0, poll4=0 (the flicker poll — count
      // still at baseline, so debounce path runs), poll5=1, then frozen at 1
      // → count change resets lastChangeAt, settle fires after settleMs.
      evaluateValues: [0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
      // Banner sequence (1st entry = baseline snapshot, rest = per-poll):
      //   baseline "Old", poll1 "Old", poll2 "flicker" (transient!),
      //   poll3+ "Old" (reverted, frozen). The flicker lasts exactly ONE
      //   poll then reverts — must NOT trip the debounced fast-fail.
      errorBannerValues: [
        { visible: true, text: "Old" },
        { visible: true, text: "Old" },
        { visible: true, text: "flicker" },
        { visible: true, text: "Old" },
      ],
      recorded,
    });

    const result = await runConversation(
      page,
      [
        {
          input: "succeeding turn with banner flicker",
          responseTimeoutMs: 5000,
        },
      ],
      { assistantSettleMs: 50 },
    );

    // The flicker reverted, so NO spurious AssistantErroredError — the turn
    // settled normally and SUCCEEDED.
    expect(result.turns_completed).toBe(1);
    expect(result.failure_turn).toBeUndefined();
    expect(result.error).toBeUndefined();
    // Real multi-poll settle loop; explicit timeout for CI headroom.
  }, 20_000);

  it("STILL fast-fails when a baseline banner's changed text is STABLE across 2 consecutive polls (genuine new error, debounced)", async () => {
    // Finding 2 regression guard: debouncing the text-changed path must NOT
    // suppress a GENUINE new error. A real new error's banner text changes
    // and then PERSISTS (it doesn't flicker back). The debounce requires the
    // changed text to be stable across 2 consecutive polls — a genuine error
    // satisfies that with one extra ~poll-interval of latency, then
    // fast-fails. This complements the round-1 re-arm test (which freezes on
    // the new text) by making the 2-poll-stability requirement explicit.
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      // Assistant count never grows past baseline (no new message arrives).
      evaluateValues: [0],
      // baseline "Old", poll1 "Old", then "New" appears at poll2 and
      // PERSISTS (poll3 still "New", then frozen on "New"). Stable across
      // ≥2 consecutive polls ⇒ genuine error ⇒ fast-fail.
      errorBannerValues: [
        { visible: true, text: "Old" },
        { visible: true, text: "Old" },
        { visible: true, text: "New" },
        { visible: true, text: "New" },
      ],
      // Turn 1 → the bounded cold-start retry fires; re-seeded queues replay
      // the same stable-new-error sequence so the 2nd attempt fast-fails again.
      reloadReplaysQueues: true,
      recorded,
    });

    const start = Date.now();
    const result = await runConversation(
      page,
      [{ input: "trigger stable new error", responseTimeoutMs: 5000 }],
      { assistantSettleMs: 50 },
    );
    const elapsed = Date.now() - start;

    expect(result.turns_completed).toBe(0);
    expect(result.failure_turn).toBe(1);
    expect(result.error).toBeDefined();
    expect(result.error).toBe(new AssistantErroredError("New").message);
    expect(result.error).toContain("copilot-error-banner visible");
    expect(result.error).toContain("New");
    expect(result.error!.toLowerCase()).not.toContain("timeout");
    // Debounce adds ~1 poll of latency; the bounded cold-start retry adds a
    // 2nd fast-fail cycle — still far under the 5000ms responseTimeout.
    expect(elapsed).toBeLessThan(3000);
    expect(result.turn_durations_ms).toHaveLength(0);
    // Real multi-poll settle loop; explicit timeout for CI headroom.
  }, 20_000);

  it("does NOT fast-fail when a FRESH banner appears for a SINGLE poll then disappears (succeeding turn)", async () => {
    // Unified-rule scenario 1 (the common false-RED on the old code): on a
    // turn with NO banner at baseline, a brand-new error banner can flicker
    // visible for exactly ONE poll (a transient toast that auto-dismisses,
    // a single re-render glitch) while the turn is actually SUCCEEDING. The
    // OLD code fast-failed IMMEDIATELY on any fresh banner (`isNewBanner`,
    // no debounce) → a spurious AssistantErroredError. The unified rule
    // debounces ALL banner detection (new AND changed) behind a 2-consecutive
    // -poll counter, so a single-poll fresh-banner flicker that reverts does
    // NOT fast-fail and the turn settles normally.
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      // Assistant count stays AT baseline (0) through the flicker poll so the
      // fresh-banner flicker is evaluated while no response has yet been
      // produced — exercising the real debounce-reset path, NOT the
      // success-in-flight disarm. THEN it grows to 1 and freezes → settles
      // AFTER the flicker poll is reached. `waitForTurnComplete` makes THREE
      // page.evaluate reads per poll: (1) SSE counter
      // `window.__hk_runsFinished`, (2) `countAssistantMessages` (DOM count),
      // (3) `findAssistantBubbleAt(idx).textContent`. Only the count read
      // drains this scripted `evaluateValues` queue — the SSE counter and
      // text branch are synthesized from the latest count in the fake. So
      // the queue values are the SUCCESSIVE COUNT READS: poll1=0, poll2=0,
      // poll3=0, poll4=0 (the flicker poll — count still at baseline, so the
      // debounce path runs), poll5=1, frozen at 1 → count change resets
      // lastChangeAt, settle fires after settleMs.
      evaluateValues: [0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
      // No banner at baseline. A FRESH banner appears for exactly ONE poll
      // (poll2) then disappears (poll3+ not visible). Single isolated poll ⇒
      // must NOT fast-fail under the unified debounce.
      errorBannerValues: [
        false,
        false,
        { visible: true, text: "transient" },
        false,
      ],
      recorded,
    });

    const result = await runConversation(
      page,
      [
        {
          input: "succeeding turn with fresh-banner flicker",
          responseTimeoutMs: 5000,
        },
      ],
      { assistantSettleMs: 50 },
    );

    // The fresh banner flickered for one poll then vanished → no spurious
    // AssistantErroredError; the turn settled and SUCCEEDED.
    expect(result.turns_completed).toBe(1);
    expect(result.failure_turn).toBeUndefined();
    expect(result.error).toBeUndefined();
    // Real multi-poll settle loop; explicit timeout for CI headroom.
  }, 20_000);

  it("fast-fails when a CHANGING-text persisted banner stays in a differs-from-baseline state across 2+ polls (countdown/timestamp mutation)", async () => {
    // Unified-rule scenario 3 (the value-debounce false-NEGATIVE on the old
    // code): a genuine error whose banner text MUTATES every poll (a retry
    // countdown "retrying 3 → 2 → 1", a live timestamp, a rotating
    // request-id) and never repeats the SAME changed value across two polls.
    // The OLD value-based `pendingChangedText` debounce keyed on the exact
    // text matching across 2 polls, so a per-poll-mutating error NEVER
    // matched → never fast-failed → burned the full 30s. The unified rule
    // keys on "differs from baseline" (a boolean state), not an exact value,
    // so a banner that stays in the differs-from-baseline state for 2
    // consecutive polls fast-fails even while its text keeps changing.
    const recorded = { fills: [] as string[], presses: [] as string[] };
    // Text mutates on EVERY poll and never repeats the prior poll's value
    // within the (short) timeout window. The OLD value-based debounce keyed
    // on the SAME changed text repeating across 2 consecutive polls, so a
    // per-poll-unique sequence NEVER matched → it would have burned the full
    // timeout (here 800ms ⇒ no generic-timeout flake under the unified rule,
    // which fast-fails on the 2nd consecutive differs-from-baseline poll).
    // Enough distinct values to outlast the 800ms / 100ms ≈ 8-poll budget so
    // the old code can't accidentally hit a frozen-last-value repeat.
    const mutating = Array.from({ length: 20 }, (_, i) => ({
      visible: true as const,
      text: `err-${i + 1}`,
    }));
    const page = makePage({
      // Assistant count never grows past baseline (no real response).
      evaluateValues: [0],
      // baseline "err-0"; then text mutates every poll ("err-1", "err-2",
      // …) — each DIFFERS from baseline, none repeats the prior poll's value.
      // errorStateNow is true on every poll ⇒ 2 consecutive ⇒ fast-fail
      // under the unified rule (on the value-debounce old code this never
      // fired and the turn burned the full timeout).
      errorBannerValues: [{ visible: true, text: "err-0" }, ...mutating],
      recorded,
    });

    const start = Date.now();
    const result = await runConversation(
      page,
      [{ input: "trigger mutating error", responseTimeoutMs: 800 }],
      { assistantSettleMs: 50 },
    );
    const elapsed = Date.now() - start;

    expect(result.turns_completed).toBe(0);
    expect(result.failure_turn).toBe(1);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("copilot-error-banner visible");
    expect(result.error!.toLowerCase()).not.toContain("timeout");
    // Fast-failed on the 2nd consecutive differs-from-baseline poll (~200ms
    // into the settle), well under the 800ms responseTimeout — the whole
    // point of the fix. On the old value-debounce code this NEVER matched a
    // repeated changed value and the turn TIMED OUT, so the error would
    // contain "timeout" and the assertions above would fail. (The wall-clock
    // here includes ~600ms of fixed harness boot/selector overhead, so we
    // assert the not-a-timeout error shape above rather than a tight elapsed
    // bound; <2000ms still proves we beat the responseTimeout settle path.)
    expect(elapsed).toBeLessThan(2000);
    expect(result.turn_durations_ms).toHaveLength(0);
    // Real multi-poll settle loop (20 mutating banner polls); explicit
    // timeout for CI headroom.
  }, 20_000);

  it("does NOT fast-fail when the assistant PRODUCED a response while a banner is also visible/sustained (success-in-flight wins)", async () => {
    // Unified-rule scenario 6 (the old code let the banner win over a real
    // response): an error banner can be visible AND sustained while the
    // assistant ALSO produced a response this turn (count grew past
    // baseline). A partial/non-fatal warning banner alongside a real answer
    // must NOT force-fail the turn. The unified rule's condition (b) makes
    // success-in-flight win: if the message count has grown past baseline,
    // the turn never fast-fails — the settle path governs, and the turn
    // SUCCEEDS.
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      // Assistant count grows past baseline IMMEDIATELY (baseline=0, then 1
      // and frozen) → a real response is in flight from the first poll on.
      evaluateValues: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      // A FRESH, SUSTAINED banner is visible every poll (would fast-fail
      // under the unified debounce if condition (b) didn't gate it on "no
      // response produced"). Because the count grew, it must be ignored.
      errorBannerValues: [
        false,
        { visible: true, text: "warn" },
        { visible: true, text: "warn" },
        { visible: true, text: "warn" },
      ],
      recorded,
    });

    const result = await runConversation(
      page,
      [{ input: "response plus banner", responseTimeoutMs: 5000 }],
      { assistantSettleMs: 50 },
    );

    // Success-in-flight wins: count grew past baseline, so the sustained
    // banner is ignored and the turn settles as a SUCCESS.
    expect(result.turns_completed).toBe(1);
    expect(result.failure_turn).toBeUndefined();
    expect(result.error).toBeUndefined();
    // Real multi-poll settle loop; explicit timeout for CI headroom.
  }, 20_000);

  it("cold-start retry: a turn-1 banner that clears after page.reload() RECOVERS (turn succeeds)", async () => {
    // Flap-band fix #71. A showcase cold-start can paint a transient error
    // banner on the FIRST turn (the agent backend / runtime is still warming
    // up) that clears on its own a beat later. PR #5142's fast-fail correctly
    // bails on a sustained banner, but on turn 1 a single bounded retry —
    // reload the page, re-send the same message — recovers the would-be flap
    // without masking a real failure. This test models attempt 1 fast-failing
    // on a fresh sustained banner, then `page.reload()` flips the page into a
    // clean state where the assistant responds and the turn SETTLES.
    let reloaded = false;
    const recorded = { fills: [] as string[], presses: [] as string[] };
    let userCalls = 0;
    let bannerReadsBeforeReload = 0;
    let assistantCallsAfterReload = 0;
    const page: Page & { reload: () => Promise<void> } = {
      async waitForSelector() {},
      async fill(_selector, value) {
        recorded.fills.push(value);
      },
      async press(_selector, key) {
        recorded.presses.push(key);
      },
      async reload() {
        reloaded = true;
        // Reset send-verification baseline so the re-send's fillAndVerifySend
        // observes fresh user-message growth.
        userCalls = 0;
      },
      async evaluate<R>(fn: () => R, arg?: unknown): Promise<R> {
        const body = fn.toString();
        if (body.includes("copilot-error-banner")) {
          // After reload: banner gone → attempt 2 settles cleanly.
          if (reloaded) return { visible: false } as never;
          // Before reload: NOT visible on the baseline snapshot (first read),
          // then a FRESH banner appears and STAYS (differs-from-baseline on 2+
          // consecutive polls) → AssistantErroredError fast-fail on attempt 1.
          bannerReadsBeforeReload++;
          if (bannerReadsBeforeReload <= 1) return { visible: false } as never;
          return {
            visible: true,
            text: "cold start: backend warming up",
          } as never;
        }
        if (body.includes("copilot-user-message")) {
          // Monotonic growth so fillAndVerifySend sees the user bubble.
          return userCalls++ as never;
        }
        // Assistant-message count. Before reload: pinned at baseline 0 (no
        // response) so attempt 1 cannot settle and the fresh banner fast-fails.
        // After reload: grows to 1 and freezes → settles.
        let count: number;
        if (!reloaded) {
          count = 0;
        } else {
          assistantCallsAfterReload++;
          count = assistantCallsAfterReload > 1 ? 1 : 0;
        }
        if (isReadCascadeStateBody(body)) {
          return cascadeStateOf(count, (arg as number) ?? 0) as never;
        }
        return count as never;
      },
    };

    const result = await runConversation(
      page,
      [{ input: "hello cold start", responseTimeoutMs: 5000 }],
      { assistantSettleMs: 50 },
    );

    // The retry recovered the flap: the turn SUCCEEDED.
    expect(reloaded).toBe(true);
    expect(result.turns_completed).toBe(1);
    expect(result.total_turns).toBe(1);
    expect(result.failure_turn).toBeUndefined();
    expect(result.error).toBeUndefined();
    // Message was re-sent after the reload (filled twice: original + retry).
    expect(recorded.fills).toEqual(["hello cold start", "hello cold start"]);
    // Real multi-poll settle loop; explicit timeout for CI headroom.
  }, 20_000);

  it("cold-start retry does NOT mask a real failure: a banner that SURVIVES the reload still fast-fails", async () => {
    // The bound that keeps #5142 intact: the cold-start retry fires AT MOST
    // ONCE, only on turn 1, only for an AssistantErroredError. If the error
    // banner is a REAL sustained failure that survives the page.reload() and
    // re-send, the second `waitForTurnComplete` invocation throws a
    // `TurnNotCompleteError` that the runner translates into the distinguished
    // `AssistantErroredError` (via the post-settle `readErrorBanner` check) —
    // the turn fails with that error, NOT a generic timeout, and NOT a false
    // success.
    let reloadCount = 0;
    const recorded = { fills: [] as string[], presses: [] as string[] };
    let userCalls = 0;
    // Per-attempt banner-read counter, reset on each reload. Each
    // `waitForTurnComplete` invocation snapshots the banner ONCE at its
    // baseline (first read) — that must be NOT visible so the subsequent
    // sustained banner reads as a differs-from-baseline NEW error and
    // fast-fails. A genuine failure does this on BOTH attempts.
    let bannerReadsThisAttempt = 0;
    const page: Page & { reload: () => Promise<void> } = {
      async waitForSelector() {},
      async fill(_selector, value) {
        recorded.fills.push(value);
      },
      async press(_selector, key) {
        recorded.presses.push(key);
      },
      async reload() {
        reloadCount++;
        userCalls = 0;
        bannerReadsThisAttempt = 0;
      },
      async evaluate<R>(fn: () => R, arg?: unknown): Promise<R> {
        const body = fn.toString();
        if (body.includes("copilot-error-banner")) {
          // NOT visible on each attempt's baseline snapshot (first read),
          // then a SUSTAINED banner that the reload does NOT clear — a REAL
          // failure. Differs-from-baseline across 2+ consecutive polls →
          // fast-fails on BOTH attempts.
          bannerReadsThisAttempt++;
          if (bannerReadsThisAttempt <= 1) return { visible: false } as never;
          return { visible: true, text: "real backend failure" } as never;
        }
        if (body.includes("copilot-user-message")) {
          return userCalls++ as never;
        }
        // Assistant never produces a response on either attempt.
        if (isReadCascadeStateBody(body)) {
          return cascadeStateOf(0, (arg as number) ?? 0) as never;
        }
        return 0 as never;
      },
    };

    const start = Date.now();
    const result = await runConversation(
      page,
      [{ input: "still broken", responseTimeoutMs: 5000 }],
      { assistantSettleMs: 50 },
    );
    const elapsed = Date.now() - start;

    // The retry happened AT MOST ONCE (bounded) — and did not mask the error.
    expect(reloadCount).toBe(1);
    expect(result.turns_completed).toBe(0);
    expect(result.total_turns).toBe(1);
    expect(result.failure_turn).toBe(1);
    // Distinguished AssistantErroredError survives the retry — NOT a timeout,
    // NOT a false success.
    expect(result.error).toBe(
      new AssistantErroredError("real backend failure").message,
    );
    expect(result.error).toContain("copilot-error-banner visible");
    expect(result.error!.toLowerCase()).not.toContain("timeout");
    // Re-sent exactly once (original + one retry), proving the retry is bounded.
    expect(recorded.fills).toEqual(["still broken", "still broken"]);
    // Bailed via fast-fail on BOTH attempts; well under the 5000ms timeout.
    expect(elapsed).toBeLessThan(3000);
    expect(result.turn_durations_ms).toHaveLength(0);
    // Real multi-poll settle loop; explicit timeout for CI headroom.
  }, 20_000);

  it("cold-start retry: a skipSend turn-1 banner FAST-FAILS without retry (the retry only fires for plain-fill turns)", async () => {
    // Flap-band #71. The cold-start retry can ONLY recover a turn it can
    // RE-ISSUE: a plain-fill turn (reload + re-fill + re-send). A `skipSend`
    // turn's submission is issued entirely by `preFill` (e.g. a
    // sample-attachment button auto-sends via the agent surface — the textarea
    // is never touched), which a reload would wipe and the skipSend path never
    // re-issues. Skipping the reload (the earlier fix) left a no-op retry that
    // re-submitted nothing, could not recover, and risked false-settling
    // against attempt 1's stale DOM. So the retry is GATED to plain-fill turns:
    // a skipSend cold-start banner now fast-fails with `AssistantErroredError`
    // (no retry, no reload, no false-settle) — PR #5142's fast-fail, the
    // pre-retry behavior for skipSend, NOT a regression.
    let reloaded = false;
    let preFillCalls = 0;
    let bannerReads = 0;
    const page: Page & { reload: () => Promise<void> } = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      // Defense-in-depth stub. Today the production skipSend branch in
      // `sendTurnMessage` (conversation-runner.ts) explicitly does NOT call
      // `waitForContentAndSend` — skipSend's submission came from `preFill`
      // and the textarea is never touched — so `page.inputValue` is not
      // exercised on this code path. We still stub it so that if the
      // production runner ever grows a pre-submit textarea-content
      // verification on the skipSend path, this test fails with the
      // BANNER-FAST-FAIL assertion it's designed to pin, not with the
      // `"page.inputValue is required"` contract throw from
      // `waitForContentAndSend` (see the sibling "throws when page.inputValue
      // is not implemented" test). Do NOT strip as unused.
      async inputValue() {
        return "stub-prefilled-text";
      },
      async reload() {
        // Must NEVER be reached for a skipSend turn — the retry is gated off.
        reloaded = true;
      },
      async evaluate<R>(fn: () => R, arg?: unknown): Promise<R> {
        const body = fn.toString();
        if (body.includes("copilot-error-banner")) {
          bannerReads++;
          // NOT visible on the baseline snapshot, then a fresh banner appears
          // and STAYS across ≥2 consecutive polls → AssistantErroredError
          // fast-fail. No retry follows for a skipSend turn.
          if (bannerReads <= 1) return { visible: false } as never;
          return {
            visible: true,
            text: "cold start: backend warming up",
          } as never;
        }
        // Assistant never produces a response — the only exit is the fast-fail.
        if (isReadCascadeStateBody(body)) {
          return cascadeStateOf(0, (arg as number) ?? 0) as never;
        }
        return 0 as never;
      },
    };

    const start = Date.now();
    const result = await runConversation(
      page,
      [
        {
          input: "skip-send sample",
          skipSend: true,
          responseTimeoutMs: 5000,
          preFill: async () => {
            preFillCalls++;
          },
        },
      ],
      { assistantSettleMs: 50 },
    );
    const elapsed = Date.now() - start;

    // No retry: the page was never reloaded and the turn failed via fast-fail.
    expect(reloaded).toBe(false);
    expect(preFillCalls).toBe(1);
    expect(result.turns_completed).toBe(0);
    expect(result.failure_turn).toBe(1);
    // The distinguished banner fast-fail error propagated (NOT a settle
    // timeout, NOT a false-settle).
    expect(result.error).toContain("copilot-error-banner visible");
    expect(result.error).toContain("cold start: backend warming up");
    expect(result.error!.toLowerCase()).not.toContain("timeout");
    // A SINGLE fast-fail cycle (no second attempt) — well under the timeout.
    expect(elapsed).toBeLessThan(3000);
    expect(result.turn_durations_ms).toHaveLength(0);
  }, 20_000);

  it("cold-start retry shares a single turn deadline — a retried turn does NOT run ~2× the budget (FF20)", async () => {
    // Flap-band #71/FF20. The first settle wait and the retry settle wait must
    // share ONE turn deadline. Without it the retry gets a fresh full
    // `turnTimeoutMs`, so a turn that fast-fails then settle-times-out on retry
    // burns ~2× the budget. Here the banner fast-fails attempt 1, the reload
    // succeeds, then the assistant NEVER responds so the retry settle-times-out.
    // With the shared deadline the total stays close to ONE turnTimeoutMs.
    const TURN_TIMEOUT = 1000;
    let reloaded = false;
    let bannerReads = 0;
    let userCalls = 0;
    const page: Page & { reload: () => Promise<void> } = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async reload() {
        reloaded = true;
        bannerReads = 0;
        userCalls = 0;
      },
      async evaluate<R>(fn: () => R, arg?: unknown): Promise<R> {
        const body = fn.toString();
        if (body.includes("copilot-error-banner")) {
          bannerReads++;
          // Fresh sustained banner on attempt 1 → fast-fail. After the reload
          // the banner is gone (so the retry does NOT fast-fail; it instead
          // burns the remaining budget waiting for a response that never comes).
          if (reloaded) return { visible: false } as never;
          if (bannerReads <= 1) return { visible: false } as never;
          return { visible: true, text: "cold start" } as never;
        }
        if (body.includes("copilot-user-message")) {
          return userCalls++ as never;
        }
        // Assistant never responds → the retry settle-times-out.
        if (isReadCascadeStateBody(body)) {
          return cascadeStateOf(0, (arg as number) ?? 0) as never;
        }
        return 0 as never;
      },
    };

    const start = Date.now();
    const result = await runConversation(
      page,
      [{ input: "deadline test", responseTimeoutMs: TURN_TIMEOUT }],
      { assistantSettleMs: 50 },
    );
    const elapsed = Date.now() - start;

    expect(reloaded).toBe(true);
    // Turn failed (assistant never settled), but the KEY assertion: the retry
    // shared the turn deadline, so total elapsed is ~1× the budget, not ~2×.
    expect(result.failure_turn).toBe(1);
    // Shared deadline: total ≈ 1× budget + the small retry floor + send-verify
    // overhead, comfortably under the OLD ~2× (two fresh full budgets would be
    // ≥ 2000ms here).
    expect(elapsed).toBeLessThan(TURN_TIMEOUT * 1.8);
  }, 20_000);

  it("cold-start retry: settle floor honours settleMs so the retry does NOT misclassify as text-unstable (R8F1)", async () => {
    // R8F1 Concern A. The cold-start retry's `timeoutMs` is
    // `Math.max(floor, turnDeadline - Date.now())`. The OLD floor
    // (`3 * POLL_INTERVAL_MS` = 300ms) was strictly less than the default
    // `assistantSettleMs` (1500ms), so when the first attempt nearly
    // exhausted the budget the retry would enter `waitForTurnComplete` with
    // `timeoutMs=300, settleMs=1500` — a MATHEMATICALLY IMPOSSIBLE gate
    // (the loop must hold text stable for `settleMs` but times out before
    // any settle window can complete). Every retry under exhausted budget
    // was GUARANTEED to misclassify as `reason=text-unstable`, hiding the
    // real cause (budget exhausted) and — in the assistant-recovers case —
    // failing a turn that would have succeeded with a real settle window.
    //
    // With the new floor (`settleMs + POLL_INTERVAL_MS`) the retry gets a
    // real settle window even when the first attempt exhausted the budget,
    // so an assistant that responds promptly post-reload can SUCCEED.
    const TURN_TIMEOUT = 500;
    const SETTLE_MS = 400; // > 3 * POLL_INTERVAL_MS (300) — under the OLD floor the gate would be impossible
    let reloaded = false;
    let bannerReads = 0;
    let userCalls = 0;
    let assistantCount = 0;
    let pollsSinceReload = 0;
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page: Page & { reload: () => Promise<void> } = {
      async waitForSelector() {},
      async fill(_selector, value) {
        recorded.fills.push(value);
      },
      async press(_selector, key) {
        recorded.presses.push(key);
      },
      async reload() {
        reloaded = true;
        // Burn most of the first attempt's budget BEFORE reload completes
        // so the retry inherits a tiny remaining slice of the turn deadline.
        // This is what the OLD floor failed to compensate for.
        await new Promise((r) => setTimeout(r, TURN_TIMEOUT));
        bannerReads = 0;
        userCalls = 0;
        assistantCount = 0;
        pollsSinceReload = 0;
      },
      async evaluate<R>(fn: () => R, arg?: unknown): Promise<R> {
        const body = fn.toString();
        if (body.includes("copilot-error-banner")) {
          bannerReads++;
          // First attempt: a banner is visible across ≥2 polls → fast-fail.
          // Post-reload: banner is gone (the cold-start condition cleared).
          if (reloaded) return { visible: false } as never;
          if (bannerReads <= 1) return { visible: false } as never;
          return { visible: true, text: "cold start" } as never;
        }
        if (body.includes("copilot-user-message")) {
          return userCalls++ as never;
        }
        if (body.includes("__hk_runsFinished")) {
          return assistantCount as never;
        }
        if (body.includes("__hk_copilotRunning")) {
          return {
            attrPresent: false,
            runningNow: null,
            sawRunningTrue: false,
            runStartCount: 0,
            lastStoppedAtMs: 0,
          } as never;
        }
        if (
          body.includes("querySelectorAll") &&
          body.includes("textContent") &&
          body.includes("{ count")
        ) {
          // Post-reload: grow to 1 on the first cascade read then hold
          // stable so the retry's settle gate has time to converge under
          // the NEW floor (settleMs + POLL_INTERVAL_MS = 500ms).
          if (reloaded) {
            pollsSinceReload++;
            if (pollsSinceReload >= 1) assistantCount = 1;
          }
          return cascadeStateOf(assistantCount, (arg as number) ?? 0) as never;
        }
        if (body.includes("querySelectorAll") && body.includes("textContent")) {
          const idx = (arg as number) ?? 0;
          if (idx < 0 || idx >= assistantCount) return null as never;
          return `assistant-bubble-text-${assistantCount}` as never;
        }
        return 0 as never;
      },
    };

    const result = await runConversation(
      page,
      [{ input: "cold-then-recovers", responseTimeoutMs: TURN_TIMEOUT }],
      { assistantSettleMs: SETTLE_MS },
    );

    // The page WAS reloaded (cold-start retry fired) AND the turn
    // RECOVERED on the retry — proving the floor honoured `settleMs` so
    // the post-reload assistant had a real chance to settle. Under the
    // OLD 300ms floor with settleMs=400, the retry would have been
    // mathematically unable to complete a settle window and the turn
    // would have failed with `reason=text-unstable`.
    expect(reloaded).toBe(true);
    expect(result.failure_turn).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.turns_completed).toBe(1);
    // The fill was issued twice — original + retry — proving the bounded
    // retry executed and re-sent.
    expect(recorded.fills).toEqual([
      "cold-then-recovers",
      "cold-then-recovers",
    ]);
  }, 20_000);

  it("cold-start retry null-narrowing guard throws translatedErr (AssistantErroredError), not settleErr (R8F1 — source pin)", async () => {
    // R8F1 Concern B. The null-narrowing guard in the cold-start retry
    // path is entered specifically because
    // `translatedErr instanceof AssistantErroredError`. The OLD code
    // threw `settleErr` (the original `TurnNotCompleteError` or
    // `BannerVisibleError`) instead of `translatedErr` — losing the
    // distinguished error class that downstream consumers (and PR #5142's
    // fast-fail surface) pin on. The fix throws `translatedErr` so the
    // AssistantErroredError surface is preserved on this fail-loud path.
    //
    // The branch is structurally unreachable via the public API today
    // (`resolveChatInputSelector` throws rather than returns `null`, and
    // the per-turn resolve at the top of the try block always runs before
    // a turn enters the fast-fail catch). The guard is defensive against
    // a future refactor that ever lets `chatInputSelector` reach the
    // retry path as `null`. Pin the contract at the SOURCE level: assert
    // the file contains the corrected `throw translatedErr;` inside the
    // null-narrowing block and does NOT contain the regressed
    // `throw settleErr;` form. A regression that swaps the two would fail
    // this test even though the runtime branch is dead code today.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(
      new URL("./conversation-runner.ts", import.meta.url),
    );
    const source = readFileSync(sourcePath, "utf8");

    // Locate the null-narrowing guard block. The block is uniquely
    // identified by the `chatInputSelector === null` check inside the
    // retry path. Extract the next non-whitespace statement after that
    // check — it MUST be `throw translatedErr;`.
    const guardMatch = source.match(
      /if \(chatInputSelector === null\) \{\s*throw (\w+);/,
    );
    expect(guardMatch).not.toBeNull();
    expect(guardMatch![1]).toBe("translatedErr");
    expect(guardMatch![1]).not.toBe("settleErr");

    // Belt-and-suspenders: scan the whole file for any remaining
    // `throw settleErr;` — the only place `settleErr` ever flowed was
    // this guard, so its absence proves the regression cannot resurface
    // by accident.
    expect(source).not.toMatch(/throw\s+settleErr\s*;/);
  });

  it("empty turns array: returns zeroes immediately", async () => {
    const page = makePage();
    const result = await runConversation(page, []);

    expect(result.turns_completed).toBe(0);
    expect(result.total_turns).toBe(0);
    expect(result.failure_turn).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.turn_durations_ms).toEqual([]);
  });

  it("RE-ARMS fast-fail when two banners share a 300-char prefix but differ after char 300 (truncation false-negative)", async () => {
    // Finding 1 (truncation false-negative): a stale baseline banner and a
    // NEW error banner can share an identical 300-char prefix (e.g. the same
    // human-readable error copy) and differ only in a trailing suffix (a
    // request-id, a timestamp, a distinct error code). If banner text is
    // truncated to 300 chars BEFORE the `textChanged` comparison, the two
    // distinct errors compare EQUAL → no fast-fail → the turn burns the full
    // responseTimeout. The fix compares the FULL banner text, so a difference
    // past char 300 still re-arms the fast-fail.
    const prefix300 = "ERR " + "A".repeat(300 - 4); // exactly 300 chars
    expect(prefix300.length).toBe(300);
    const baselineText = prefix300 + "AAA"; // 303 chars
    const newErrorText = prefix300 + "BBB"; // 303 chars, same first 300
    // Sanity: the two differ ONLY after char 300.
    expect(baselineText.slice(0, 300)).toBe(newErrorText.slice(0, 300));
    expect(baselineText).not.toBe(newErrorText);

    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      // Assistant count never grows past baseline (no new message arrives).
      evaluateValues: [0],
      // Banner visible at baseline with `baselineText` (stale), then its text
      // changes to `newErrorText` mid-settle — differing only past char 300.
      errorBannerValues: [
        { visible: true, text: baselineText },
        { visible: true, text: baselineText },
        { visible: true, text: newErrorText },
      ],
      // Turn 1 → the bounded cold-start retry fires; re-seeded queues replay
      // the same prefix-collision sequence so the 2nd attempt re-arms on the
      // full-text comparison and fast-fails again. The truncation-false-negative
      // fix stays intact across the retry.
      reloadReplaysQueues: true,
      recorded,
    });

    const start = Date.now();
    const result = await runConversation(
      page,
      [{ input: "trigger suffix-only error", responseTimeoutMs: 5000 }],
      { assistantSettleMs: 50 },
    );
    const elapsed = Date.now() - start;

    expect(result.turns_completed).toBe(0);
    expect(result.failure_turn).toBe(1);
    expect(result.error).toBeDefined();
    // Fast-failed on the NEW error (differs only past char 300) — proves the
    // comparison used the FULL text, not a 300-char truncation.
    expect(result.error).toContain("copilot-error-banner visible");
    expect(result.error!.toLowerCase()).not.toContain("timeout");
    // The thrown message is truncated for log hygiene, so it carries the
    // shared prefix; the distinguishing suffix may be elided. What matters is
    // that we fast-failed at all (timeout would mean the bug reproduced).
    expect(result.error).toContain(prefix300.slice(0, 50));
    // Bailed well before the 5000ms responseTimeout — the whole point. The
    // bounded cold-start retry adds a 2nd fast-fail cycle, so the bound is
    // 3000ms (two cycles), still far under the 5000ms settle timeout.
    expect(elapsed).toBeLessThan(3000);
    expect(result.turn_durations_ms).toHaveLength(0);
    // Real multi-poll settle loop; explicit timeout for CI headroom.
  }, 20_000);

  it("falls through the chat-input selectors and uses the first that resolves", async () => {
    // Track which selectors were tried. The first that doesn't throw wins.
    const triedSelectors: string[] = [];
    let evalCalls = 0;
    const page: Page = {
      async waitForSelector(selector) {
        triedSelectors.push(selector);
        // Force the first two to throw so the third one wins. The runner
        // must keep trying — anything else means it would false-fail on
        // showcases that don't have the canonical V2 textarea testid.
        if (triedSelectors.length < 3) {
          throw new Error(`no match: ${selector}`);
        }
      },
      async fill() {},
      async press() {},
      evaluate: wrapEvaluateForUserMessages(async () => {
        // First read is the baseline (= 0); subsequent reads return 1
        // and stay there → growth past baseline + stable → settled.
        evalCalls++;
        return (evalCalls === 1 ? 0 : 1) as never;
      }),
    };

    const result = await runConversation(page, [{ input: "hi" }], {
      assistantSettleMs: 30,
    });

    expect(result.turns_completed).toBe(1);
    expect(triedSelectors.length).toBeGreaterThanOrEqual(3);
    // First selector must be the canonical V2 textarea testid — fillable.
    // The previous wrapper-div testid (`[data-testid="copilot-chat-input"]`)
    // matched a `<div>` and `page.fill()` would always throw on it.
    expect(triedSelectors[0]).toBe('[data-testid="copilot-chat-textarea"]');
    // Second selector scopes a textarea descendant under the wrapper for
    // V2 UIs whose textarea doesn't have its own testid.
    expect(triedSelectors[1]).toBe(
      '[data-testid="copilot-chat-input"] textarea',
    );
    // Third selector is the bare `textarea` fallback (V1 / generic UIs).
    expect(triedSelectors[2]).toBe("textarea");
    // The bare wrapper-div selector MUST NOT appear before `textarea` —
    // it's a non-fillable `<div>` and Playwright's `fill()` would throw.
    const wrapperIdx = triedSelectors.indexOf(
      '[data-testid="copilot-chat-input"]',
    );
    const textareaIdx = triedSelectors.indexOf("textarea");
    if (wrapperIdx !== -1) {
      expect(wrapperIdx).toBeGreaterThan(textareaIdx);
    }
  });

  it("calls fill() on the resolved fillable selector, not the wrapper div", async () => {
    // Simulate the V2 DOM where the wrapper-div testid would match (if
    // it were in the cascade) but only the textarea descendant is
    // actually fillable. The cascade must resolve to the textarea
    // selector and `fill()` must be invoked with THAT selector — never
    // the bare wrapper div.
    const filledSelectors: string[] = [];
    const triedSelectors: string[] = [];
    let evalCalls = 0;
    const page: Page = {
      async waitForSelector(selector) {
        triedSelectors.push(selector);
        // Pretend the V2 textarea testid resolves successfully (it's the
        // first selector in the cascade and the strictest, fillable one).
      },
      async fill(selector, _value) {
        filledSelectors.push(selector);
        // The bare wrapper-div selector must never reach fill() — that's
        // the bug this test pins. Throw loudly if it ever does.
        if (selector === '[data-testid="copilot-chat-input"]') {
          throw new Error(
            "fill() invoked on wrapper div — would throw in real Playwright",
          );
        }
      },
      async press() {},
      evaluate: wrapEvaluateForUserMessages(async () => {
        evalCalls++;
        return (evalCalls === 1 ? 0 : 1) as never;
      }),
    };

    const result = await runConversation(page, [{ input: "hello" }], {
      assistantSettleMs: 30,
    });

    expect(result.turns_completed).toBe(1);
    // Resolved selector is the V2 textarea testid (cascade slot #1).
    expect(filledSelectors).toEqual(['[data-testid="copilot-chat-textarea"]']);
    // And explicitly NOT the wrapper-div selector that `page.fill()` chokes on.
    expect(filledSelectors).not.toContain('[data-testid="copilot-chat-input"]');
  });

  it("honours opts.chatInputSelector when provided (skips cascade)", async () => {
    const triedSelectors: string[] = [];
    let evalCalls = 0;
    const page: Page = {
      async waitForSelector(selector) {
        triedSelectors.push(selector);
      },
      async fill() {},
      async press() {},
      evaluate: wrapEvaluateForUserMessages(async () => {
        evalCalls++;
        return (evalCalls === 1 ? 0 : 1) as never;
      }),
    };

    const result = await runConversation(page, [{ input: "hi" }], {
      chatInputSelector: "#custom-input",
      assistantSettleMs: 30,
    });

    expect(result.turns_completed).toBe(1);
    expect(triedSelectors).toEqual(["#custom-input"]);
  });

  it("uses turn responseTimeoutMs override when provided", async () => {
    // Force a never-respond turn with a tiny per-turn override.
    const page = makePage({ evaluateValues: [0] });
    const start = Date.now();
    const result = await runConversation(
      page,
      [{ input: "hello", responseTimeoutMs: 100 }],
      { assistantSettleMs: 30 },
    );
    const elapsed = Date.now() - start;

    expect(result.failure_turn).toBe(1);
    // Should respect the 100ms override — bail well before the 30s default.
    expect(elapsed).toBeLessThan(2000);
  });

  it("propagates errors thrown during fill() as a turn failure", async () => {
    const page = makePage({ throwOnFill: new Error("input not editable") });
    const result = await runConversation(page, [{ input: "hi" }], {
      assistantSettleMs: 30,
    });

    expect(result.turns_completed).toBe(0);
    expect(result.failure_turn).toBe(1);
    expect(result.error).toContain("input not editable");
  });

  it("fails turn 1 with a 'chat input not found' error when no selector matches", async () => {
    // Every selector in the cascade throws — no chat input found.
    const page: Page = {
      async waitForSelector(selector) {
        throw new Error(`no match for ${selector}`);
      },
      async fill() {},
      async press() {},
      async evaluate() {
        return 0 as never;
      },
    };
    const result = await runConversation(
      page,
      [{ input: "first" }, { input: "second" }],
      { assistantSettleMs: 30 },
    );
    expect(result.turns_completed).toBe(0);
    expect(result.total_turns).toBe(2);
    expect(result.failure_turn).toBe(1);
    expect(result.error).toContain("chat input not found");
    expect(result.turn_durations_ms).toEqual([]);
  });

  it("survives transient evaluate() errors (caught + treated as count=0)", async () => {
    // page.evaluate throws on the very first read (baseline) but recovers
    // on subsequent reads. The runner's `countAssistantMessages` swallows
    // evaluate errors and returns 0 so the baseline becomes 0 and the turn
    // still settles when the count grows.
    let assistantCalls = 0;
    let userCalls = 0;
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate(fn, ...rest: unknown[]) {
        const body = fn.toString();
        // User-message reads return a monotonically increasing count
        // so fillAndVerifySend sees growth and doesn't retry.
        if (body.includes("copilot-user-message")) {
          return userCalls++ as never;
        }
        // Error-banner visibility probe: return the runner-expected
        // `{ visible: false }` shape (mirrors `wrapEvaluateForUserMessages`).
        // Without this branch the read fell through to the assistant-count
        // path and returned a NUMBER — the no-banner path only "passed" by
        // the accident that `(number).visible` is `undefined` (falsy).
        if (body.includes("copilot-error-banner")) {
          return { visible: false } as never;
        }
        assistantCalls++;
        if (assistantCalls === 1) throw new Error("evaluate boom");
        if (isReadCascadeStateBody(body)) {
          return cascadeStateOf(1, (rest[0] as number) ?? 0) as never;
        }
        return 1 as never;
      },
    };
    const result = await runConversation(page, [{ input: "hi" }], {
      assistantSettleMs: 30,
    });
    expect(result.turns_completed).toBe(1);
  });

  it("readMessageCount narrows fallback to assistant-only articles", async () => {
    // Stand up a fake document.querySelectorAll that records the
    // selector strings the runner asks for, and returns counts based
    // on a per-selector script. We need the count to grow past
    // baseline so the conversation actually settles (otherwise we
    // hit the test timeout); a tiny call counter ramps the assistant
    // count from 0 to 2 across consecutive evaluate() invocations.
    const queriedSelectors: string[] = [];
    let evalCount = 0;
    // A minimal `NodeList`-shaped object: `length` for the cascade-tier
    // selector (count read) AND `item(idx)` returning a synthetic bubble
    // for the atomic `readCascadeState` closure's per-tier text read.
    // The synthetic bubble's `querySelector` resolves the first scoped
    // selector to a non-empty `textContent` so the settle gate's
    // text-stable conjunct fires once the count grows past baseline.
    const matchList = (
      length: number,
    ): {
      length: number;
      item: (i: number) => {
        textContent: string;
        querySelector: (s: string) => { textContent: string } | null;
      } | null;
    } => ({
      length,
      item(i: number) {
        if (i < 0 || i >= length) return null;
        return {
          textContent: `bubble-${i}`,
          querySelector(_s: string) {
            return { textContent: `bubble-${i}` };
          },
        };
      },
    });
    const fakeDocument = {
      querySelectorAll: (sel: string) => {
        queriedSelectors.push(sel);
        // Canonical testid: 0 (forces fallback path).
        if (sel === '[data-testid="copilot-assistant-message"]') {
          return matchList(0);
        }
        // Tagged-assistant articles: 0 (forces narrowed-article path).
        if (sel === '[role="article"][data-message-role="assistant"]') {
          return matchList(0);
        }
        // Narrowed-article selector excludes user-tagged articles.
        // First call (baseline) → 0; subsequent calls → 2 (settled).
        if (sel === '[role="article"]:not([data-message-role="user"])') {
          return matchList(evalCount === 0 ? 0 : 2);
        }
        // Headless tier: present in cascade for custom-composer demos
        // (e.g. headless-simple) that don't use [role="article"].
        // Returns 0 here so the narrowed-article tier is the one that
        // actually drives the settle loop.
        if (sel === '[data-message-role="assistant"]') {
          return matchList(0);
        }
        // ANY other [role="article"] selector means we leaked the
        // unscoped fallback that this fix was supposed to remove.
        return matchList(999);
      },
      // The error-banner probe (readErrorBanner) calls
      // document.querySelector — returning null exercises the genuine
      // "no banner" path. Without this the call throws a TypeError that
      // readErrorBanner silently swallows, so the probe was never really
      // tested here.
      querySelector: (): null => null,
    };

    let userMsgCalls1 = 0;
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate(fn) {
        // User-message reads bypass the fake document entirely — we
        // only care about assistant-message selector queries here.
        if (fn.toString().includes("copilot-user-message")) {
          return userMsgCalls1++ as never;
        }
        // The SSE run-finished counter (`window.__hk_runsFinished`) is
        // read by `waitForTurnComplete`'s SSE conjunct. The bare-document
        // fake doesn't seed that global, so without an explicit branch the
        // SSE check returns 0 forever and the turn times out. Mirror
        // `makePage`'s synthesis rule: once the assistant DOM has any
        // bubbles, the server must have flushed at least that many
        // RUN_FINISHED events. Use the narrowed-article post-baseline
        // count (2) once the test has stepped past its baseline read.
        if (fn.toString().includes("__hk_runsFinished")) {
          return (evalCount === 0 ? 0 : 2) as never;
        }
        // This bare-document fake never renders the v2 chat-view attribute
        // — return the "attribute absent" shape so `waitForTurnComplete`
        // routes to the SSE-counter fallback above (unchanged semantics).
        if (fn.toString().includes("__hk_copilotRunning")) {
          return {
            attrPresent: false,
            runningNow: null,
            sawRunningTrue: false,
            runStartCount: 0,
            lastStoppedAtMs: 0,
          } as never;
        }
        // Patch globalThis.document with our fake for the duration
        // of the evaluate call. The selector-fn closes over
        // globalThis at runtime, mirroring the browser-side execution.
        // Also stub getComputedStyle so the error-banner probe runs its
        // real code path (returning a visible style) instead of throwing
        // a swallowed TypeError on the missing global.
        const originalDoc = (globalThis as { document?: unknown }).document;
        const originalGCS = (globalThis as { getComputedStyle?: unknown })
          .getComputedStyle;
        (globalThis as { document?: unknown }).document = fakeDocument;
        (globalThis as { getComputedStyle?: unknown }).getComputedStyle =
          (() => ({ display: "block", visibility: "visible" })) as unknown;
        try {
          const r = fn();
          evalCount++;
          return r as never;
        } finally {
          (globalThis as { document?: unknown }).document = originalDoc;
          (globalThis as { getComputedStyle?: unknown }).getComputedStyle =
            originalGCS;
        }
      },
    };

    const result = await runConversation(page, [{ input: "hi" }], {
      assistantSettleMs: 30,
    });

    // Conversation completed without timing out.
    expect(result.turns_completed).toBe(1);
    // The narrowed fallback selector MUST appear in the queried set.
    expect(queriedSelectors).toContain(
      '[role="article"]:not([data-message-role="user"])',
    );
    // The unscoped selector that this fix was supposed to remove
    // MUST NOT appear.
    expect(queriedSelectors).not.toContain('[role="article"]');
  });

  it("readMessageCount prefers an explicit assistant-tagged article", async () => {
    // When the canonical testid is absent but the page DOES tag
    // articles with `data-message-role="assistant"`, that branch
    // wins — the unscoped fallback is never queried. We ramp
    // tagged-assistant from 1 to 2 across calls so baseline=1 and
    // settled-count=2 (count grew past baseline, then stable). The
    // fallback selector is unreachable on every call because
    // tagged.length > 0 short-circuits the function.
    const queriedSelectors: string[] = [];
    let evalCount = 0;
    // See sibling test above for `matchList` rationale — provides
    // both `length` AND `item(idx)` so the atomic `readCascadeState`
    // closure can read per-tier scoped text in the same call.
    const matchList = (
      length: number,
    ): {
      length: number;
      item: (i: number) => {
        textContent: string;
        querySelector: (s: string) => { textContent: string } | null;
      } | null;
    } => ({
      length,
      item(i: number) {
        if (i < 0 || i >= length) return null;
        return {
          textContent: `bubble-${i}`,
          querySelector(_s: string) {
            return { textContent: `bubble-${i}` };
          },
        };
      },
    });
    const fakeDocument = {
      querySelectorAll: (sel: string) => {
        queriedSelectors.push(sel);
        if (sel === '[data-testid="copilot-assistant-message"]') {
          return matchList(0);
        }
        if (sel === '[role="article"][data-message-role="assistant"]') {
          return matchList(evalCount === 0 ? 1 : 2);
        }
        return matchList(999);
      },
      // The error-banner probe (readErrorBanner) calls
      // document.querySelector — returning null exercises the genuine
      // "no banner" path instead of a swallowed TypeError.
      querySelector: (): null => null,
    };

    let userMsgCalls2 = 0;
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate(fn) {
        // User-message reads bypass the fake document entirely.
        if (fn.toString().includes("copilot-user-message")) {
          return userMsgCalls2++ as never;
        }
        // Seed the SSE run-finished counter for the same reason as the
        // sibling narrowed-fallback test — `waitForTurnComplete`'s SSE
        // conjunct must converge or the turn times out. Tagged-assistant
        // count is 1 at baseline and 2 thereafter, so any post-baseline
        // poll has at least 2 RUN_FINISHED equivalents.
        if (fn.toString().includes("__hk_runsFinished")) {
          return (evalCount === 0 ? 1 : 2) as never;
        }
        // Bare-document fake — no v2 chat-view attribute; return absent so
        // the gate uses the SSE-counter fallback (unchanged semantics).
        if (fn.toString().includes("__hk_copilotRunning")) {
          return {
            attrPresent: false,
            runningNow: null,
            sawRunningTrue: false,
            runStartCount: 0,
            lastStoppedAtMs: 0,
          } as never;
        }
        // Patch document + getComputedStyle so the error-banner probe
        // runs its real "no banner" path (see the narrowing test above).
        const originalDoc = (globalThis as { document?: unknown }).document;
        const originalGCS = (globalThis as { getComputedStyle?: unknown })
          .getComputedStyle;
        (globalThis as { document?: unknown }).document = fakeDocument;
        (globalThis as { getComputedStyle?: unknown }).getComputedStyle =
          (() => ({ display: "block", visibility: "visible" })) as unknown;
        try {
          const r = fn();
          evalCount++;
          return r as never;
        } finally {
          (globalThis as { document?: unknown }).document = originalDoc;
          (globalThis as { getComputedStyle?: unknown }).getComputedStyle =
            originalGCS;
        }
      },
    };

    const result = await runConversation(page, [{ input: "hi" }], {
      assistantSettleMs: 30,
    });

    expect(result.turns_completed).toBe(1);
    expect(queriedSelectors).toContain(
      '[role="article"][data-message-role="assistant"]',
    );
    expect(queriedSelectors).not.toContain(
      '[role="article"]:not([data-message-role="user"])',
    );
    // 999 sentinel never returned (the fallback path was never taken).
    expect(queriedSelectors).not.toContain('[role="article"]');
  });

  it("preFill runs BEFORE fill on each turn", async () => {
    // Record the order of operations across multiple page methods to
    // prove preFill executes before the runner-level fill+press.
    const order: string[] = [];
    let evalCalls = 0;
    const page: Page = {
      async waitForSelector() {},
      async fill(_selector, value) {
        order.push(`fill:${value}`);
      },
      async press(_selector, _key) {
        order.push("press");
      },
      evaluate: wrapEvaluateForUserMessages(async () => {
        evalCalls++;
        // Baseline=0; subsequent reads=1 → growth + stable → settled.
        return (evalCalls === 1 ? 0 : 1) as never;
      }),
    };

    const turns: ConversationTurn[] = [
      {
        input: "hello",
        preFill: async () => {
          order.push("preFill");
        },
      },
    ];

    const result = await runConversation(page, turns, {
      assistantSettleMs: 30,
    });

    expect(result.turns_completed).toBe(1);
    // preFill MUST appear before the corresponding fill+press for that turn.
    const preFillIdx = order.indexOf("preFill");
    const fillIdx = order.indexOf("fill:hello");
    const pressIdx = order.indexOf("press");
    expect(preFillIdx).toBeGreaterThanOrEqual(0);
    expect(fillIdx).toBeGreaterThan(preFillIdx);
    expect(pressIdx).toBeGreaterThan(fillIdx);
  });

  it("preFill throwing causes the turn to fail with the thrown error", async () => {
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({ recorded });

    let turn2Ran = false;
    const turns: ConversationTurn[] = [
      {
        input: "first",
        preFill: async () => {
          throw new Error("attach button missing");
        },
      },
      {
        input: "second",
        preFill: async () => {
          turn2Ran = true;
        },
      },
    ];

    const result = await runConversation(page, turns, {
      assistantSettleMs: 30,
    });

    expect(result.turns_completed).toBe(0);
    expect(result.total_turns).toBe(2);
    expect(result.failure_turn).toBe(1);
    expect(result.error).toContain("attach button missing");
    // The runner did NOT fill/press for the failed turn — preFill threw
    // before the fill cascade ran.
    expect(recorded.fills).toEqual([]);
    expect(recorded.presses).toEqual([]);
    // Subsequent turns must NOT run after a preFill failure (mirrors
    // the assertion-failure semantics).
    expect(turn2Ran).toBe(false);
    // Failed turn's duration is not recorded.
    expect(result.turn_durations_ms).toEqual([]);
  });

  it("turn without preFill works exactly as before (regression guard)", async () => {
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      // Simple settle: 0 → 1 stable.
      evaluateValues: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
      recorded,
    });

    const turns: ConversationTurn[] = [{ input: "hello" }];
    const result = await runConversation(page, turns, {
      assistantSettleMs: 30,
    });

    expect(result.turns_completed).toBe(1);
    expect(result.failure_turn).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(recorded.fills).toEqual(["hello"]);
    expect(recorded.presses).toEqual(["Enter"]);
  });

  it("preFill mounts the chat input — resolution is deferred past preFill (auth-shape regression)", async () => {
    // Idiomatic auth demos (langgraph-python) render a SignInCard until
    // the user clicks "Sign in with demo token". The chat input only
    // mounts AFTER that click, which preFill performs. Before this
    // ordering fix, runConversation resolved the input cascade up
    // front and timed out before preFill ever ran. This test pins the
    // post-fix invariant: cascade probe throws while unmounted,
    // preFill makes it visible, the runner then resolves and proceeds.
    let chatMounted = false;
    let assistantCalls = 0;
    const order: string[] = [];
    const page: Page = {
      async waitForSelector(selector) {
        order.push(`waitForSelector:${selector}`);
        if (!chatMounted) {
          throw new Error(`no match for ${selector}`);
        }
      },
      async fill(_selector, value) {
        order.push(`fill:${value}`);
      },
      async press() {
        order.push("press");
      },
      evaluate: wrapEvaluateForUserMessages(async () => {
        // Baseline read returns 0; subsequent assistant reads return
        // 1 so the message-count growth check settles.
        assistantCalls += 1;
        return (assistantCalls === 1 ? 0 : 1) as never;
      }),
    };

    const turns: ConversationTurn[] = [
      {
        input: "hello",
        preFill: async () => {
          order.push("preFill:click-sign-in");
          chatMounted = true;
        },
      },
    ];

    const result = await runConversation(page, turns, {
      assistantSettleMs: 30,
    });

    expect(result.turns_completed).toBe(1);
    expect(result.failure_turn).toBeUndefined();
    // The runner probes the chat-input cascade at BOOT (before preFill
    // runs), expecting it to fail when the chat tree hasn't mounted yet
    // (the auth shape). When boot probing fails the runner defers to
    // post-preFill resolution — preFill runs, mounts the chat, and the
    // cascade succeeds on retry. What matters: preFill runs, AT LEAST
    // ONE post-preFill waitForSelector resolves (proving the cascade
    // recovered), AND the conversation completes turn 1 cleanly.
    // (We do NOT assert "no waitForSelector before preFill" — the boot
    // probe is intentional and the failure is handled gracefully.)
    const preFillIdx = order.indexOf("preFill:click-sign-in");
    expect(preFillIdx).toBeGreaterThanOrEqual(0);
    // Some waitForSelector call must run AFTER preFill — that's the
    // cascade retry that resolves once the chat input mounted.
    const postPreFillWait = order
      .slice(preFillIdx + 1)
      .find((s) => s.startsWith("waitForSelector:"));
    expect(postPreFillWait).toBeDefined();
  });

  it("stringifies non-Error throws (e.g. a thrown string) into result.error", async () => {
    // Some libraries throw non-Error values. The runner's errorMessage
    // helper falls back to String(err) so callers always see a usable
    // message.
    const page: Page = {
      async waitForSelector() {},
      async fill() {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "non-error string boom";
      },
      async press() {},
      async evaluate() {
        return 0 as never;
      },
    };
    const result = await runConversation(page, [{ input: "hi" }], {
      assistantSettleMs: 30,
    });
    expect(result.failure_turn).toBe(1);
    expect(result.error).toContain("non-error string boom");
  });
});

describe("runConversation surface-mount completion (completeOnMount)", () => {
  /**
   * Purpose-built fake modelling the A2UI-declarative completion shape:
   * the run FINISHES and a new assistant bubble appears, but the bubble's
   * scoped TEXT is ALWAYS EMPTY (the demo emits a `render_a2ui` surface,
   * not assistant prose) — so the default text-stability conjunct can
   * never converge. A configurable set of render-surface testids mounts
   * (or never mounts, for the integrity/red case).
   *
   * Routes `page.evaluate` by inspecting the closure body, mirroring
   * `makePage`'s dispatch but with two key differences:
   *   - the cascade-state read always returns non-empty `count` with
   *     `text: ""` (empty → text-stability impossible), and
   *   - the `readTestIdCounts` closure (body has `data-testid` + builds an
   *     `out` map, no `{ count`) returns the scripted per-testid counts.
   */
  function makeSurfacePage(opts: {
    /** Per-testid count returned AFTER the surface "mounts". */
    mounted: Record<string, number>;
    /**
     * Polls before the surface mounts — until then `readTestIdCounts`
     * returns all-zero. Default 1 (mounts almost immediately). Set high
     * (or never-mounting via `neverMount`) to model a broken render.
     */
    mountAfterPolls?: number;
    /** When true the surface NEVER mounts (integrity/red case). */
    neverMount?: boolean;
  }): Page {
    const mountAfter = opts.mountAfterPolls ?? 1;
    let surfacePolls = 0;
    // Track whether the user message has been submitted. Before send the
    // assistant-bubble count is 0 (the pre-send `baselineCount` snapshot);
    // after the Enter press a new bubble exists (count=1) so the gate's
    // `count > baselineCount` (domOk) conjunct holds for THIS turn.
    let sent = false;
    return {
      async waitForSelector() {},
      async fill() {},
      async press() {
        sent = true;
      },
      async evaluate(fn: () => unknown) {
        const body = fn.toString();
        // SSE counter: caught up only after the run (post-send).
        if (body.includes("__hk_runsFinished")) return (sent ? 1 : 0) as never;
        // Surface-mount fake — no v2 chat-view attribute; return absent so
        // the done-signal falls back to the SSE counter above.
        if (body.includes("__hk_copilotRunning")) {
          return {
            attrPresent: false,
            runningNow: null,
            sawRunningTrue: false,
            runStartCount: 0,
            lastStoppedAtMs: 0,
          } as never;
        }
        // No error banner.
        if (body.includes("copilot-error-banner")) {
          return { state: "absent" } as never;
        }
        // User-message read: monotonic so fillAndVerifySend succeeds fast.
        if (body.includes("copilot-user-message")) {
          return 1 as never;
        }
        // Cascade-state read (`readCascadeStateLast`): builds `{ count, text }`.
        // Route FIRST among the querySelectorAll branches — its closure ALSO
        // references the `copilot-assistant-message` tier selector, so it
        // must win before the count branch. A NEW bubble exists (count=1) but
        // its scoped TEXT is ALWAYS EMPTY — text-stability can never hold.
        if (
          body.includes("querySelectorAll") &&
          body.includes("textContent") &&
          body.includes("{ count")
        ) {
          return { count: sent ? 1 : 0, text: "" } as never;
        }
        // countAssistantMessages (baseline snapshot + final-read
        // classification): references the canonical assistant testid but does
        // NOT build `{ count`. Returns a NUMBER — 0 before send (baseline), 1
        // after (a new bubble exists for this turn).
        if (body.includes("copilot-assistant-message")) {
          return (sent ? 1 : 0) as never;
        }
        // readTestIdCounts: references data-testid + querySelectorAll, builds
        // an `out` map, no `{ count`, no `copilot-assistant-message`. This is
        // the surface-mount poll.
        if (body.includes("data-testid") && body.includes("querySelectorAll")) {
          surfacePolls += 1;
          const ready = !opts.neverMount && surfacePolls >= mountAfter;
          return (ready ? opts.mounted : {}) as never;
        }
        // Fallback: treat any other querySelectorAll read as 1 bubble.
        if (body.includes("querySelectorAll")) return 1 as never;
        return 0 as never;
      },
    };
  }

  it("GREEN: completes a text-empty A2UI turn once the render surface mounts (no text-stability)", async () => {
    // The run finished + a new bubble exists, text is empty forever, but
    // the declarative dashboard testids mount → the turn completes and the
    // assertion runs. Without `completeOnMount` this same shape would time
    // out as `text-unstable`.
    const page = makeSurfacePage({
      mounted: {
        "declarative-metric": 4,
        "declarative-pie-chart": 1,
        "declarative-bar-chart": 1,
      },
      mountAfterPolls: 2,
    });
    let assertionRan = false;
    const result = await runConversation(
      page,
      [
        {
          input: "Show me my sales dashboard for this quarter.",
          completeOnMount: {
            testIds: [
              "declarative-metric",
              "declarative-pie-chart",
              "declarative-bar-chart",
            ],
            minNewMounts: 1,
          },
          assertions: async () => {
            assertionRan = true;
          },
        },
      ],
      { assistantSettleMs: 50 },
    );
    expect(result.failure_turn).toBeUndefined();
    expect(result.turns_completed).toBe(1);
    expect(assertionRan).toBe(true);
  }, 20_000);

  it("INTEGRITY (red): the SAME turn FAILS surface-missing when the surface never mounts", async () => {
    // Broken render: run finishes, a new bubble appears, text is empty —
    // but NO declarative testids ever mount. The surface-mount completion
    // must NOT pass; the turn must fail. This proves the fixed gate stays
    // RED when the feature does not render (it is not "always green now").
    const page = makeSurfacePage({
      mounted: {},
      neverMount: true,
    });
    let assertionRan = false;
    const result = await runConversation(
      page,
      [
        {
          input: "Show me my sales dashboard for this quarter.",
          // Short timeout so the never-mount case fails fast in-test.
          responseTimeoutMs: 1_200,
          completeOnMount: {
            testIds: [
              "declarative-metric",
              "declarative-pie-chart",
              "declarative-bar-chart",
            ],
            minNewMounts: 1,
          },
          assertions: async () => {
            assertionRan = true;
          },
        },
      ],
      { assistantSettleMs: 50 },
    );
    expect(result.failure_turn).toBe(1);
    expect(result.error).toContain("surface-missing");
    // The assertion (real render check) must NOT have run — the gate threw
    // before it.
    expect(assertionRan).toBe(false);
  }, 20_000);

  it("INTEGRITY (red): fails surface-missing when only a LEFTOVER surface is present (no new mount)", async () => {
    // The expected testids ARE present but were all already in the
    // pre-send baseline (leftover from a prior turn) — zero newly mounted.
    // The delta gate (`minNewMounts: 1`) must reject this so a stale
    // surface cannot satisfy completion. The fake returns the same counts
    // on the pre-send baseline read AND every poll, so `newlyMounted` is 0.
    const leftover = {
      "declarative-metric": 4,
      "declarative-pie-chart": 1,
      "declarative-bar-chart": 1,
    };
    const page = makeSurfacePage({
      mounted: leftover,
      mountAfterPolls: 1, // present from the very first read (incl. baseline)
    });
    const result = await runConversation(
      page,
      [
        {
          input: "Show me my sales dashboard for this quarter.",
          responseTimeoutMs: 1_200,
          completeOnMount: {
            testIds: [
              "declarative-metric",
              "declarative-pie-chart",
              "declarative-bar-chart",
            ],
            minNewMounts: 1,
          },
        },
      ],
      { assistantSettleMs: 50 },
    );
    expect(result.failure_turn).toBe(1);
    expect(result.error).toContain("surface-missing");
  }, 20_000);
});

describe("fillAndVerifySend", () => {
  it("succeeds on first attempt when user message appears immediately", async () => {
    const recorded = { fills: [] as string[], presses: [] as string[] };
    // User message count: baseline=0, then 1 after Enter → success on first attempt.
    const page = makePage({
      recorded,
      userMessageValues: [0, 1],
    });

    await fillAndVerifySend(page, "textarea", "hello world");

    // fill+press called exactly once — no retry needed.
    expect(recorded.fills).toEqual(["hello world"]);
    expect(recorded.presses).toEqual(["Enter"]);
  });

  it("retries when first attempt fails (no user message) and succeeds on second", async () => {
    const recorded = { fills: [] as string[], presses: [] as string[] };
    // Attempt 1: baseline=0, single poll returns 0 → timeout, retry.
    // Attempt 2: single poll returns 1 → success.
    // With short delays (initialDelayMs=10, timeoutMs=50) each attempt
    // fits exactly 1 poll (POLL_INTERVAL_MS=100 > remaining 40ms window).
    const userValues: number[] = [
      0, // baseline read
      0, // attempt 1: single poll → no growth → retry
      1, // attempt 2: single poll → growth → success
    ];
    const page = makePage({
      recorded,
      userMessageValues: userValues,
    });

    await fillAndVerifySend(page, "textarea", "retry me", {
      initialDelayMs: 10,
      timeoutMs: 50,
    });

    // fill+press called twice — first attempt failed, second succeeded.
    expect(recorded.fills).toEqual(["retry me", "retry me"]);
    expect(recorded.presses).toEqual(["Enter", "Enter"]);
  });

  it("falls through after all 3 retries fail without throwing", async () => {
    const recorded = { fills: [] as string[], presses: [] as string[] };
    // All 3 attempts see user message count stuck at 0. The function
    // should return silently (not throw) so the downstream timeout
    // produces a clear failure message.
    const page = makePage({
      recorded,
      userMessageValues: [0], // stays at 0 forever (single-value freeze)
    });

    // Should NOT throw — just returns after exhausting retries.
    // Use short delays so the test doesn't exceed the 5s timeout.
    await fillAndVerifySend(page, "textarea", "doomed", {
      initialDelayMs: 10,
      timeoutMs: 50,
    });

    // fill+press called 3 times (max attempts).
    expect(recorded.fills).toEqual(["doomed", "doomed", "doomed"]);
    expect(recorded.presses).toEqual(["Enter", "Enter", "Enter"]);
  });
});

describe("readUserMessageCount", () => {
  it("returns 0 when no user messages exist", async () => {
    const fakeDocument = {
      querySelectorAll: (_sel: string): { length: number } => ({ length: 0 }),
    };
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate(fn) {
        const originalDoc = (globalThis as { document?: unknown }).document;
        (globalThis as { document?: unknown }).document = fakeDocument;
        try {
          return fn() as never;
        } finally {
          (globalThis as { document?: unknown }).document = originalDoc;
        }
      },
    };
    expect(await readUserMessageCount(page)).toBe(0);
  });

  it("prefers canonical testid when present", async () => {
    const queriedSelectors: string[] = [];
    const fakeDocument = {
      querySelectorAll: (sel: string): { length: number } => {
        queriedSelectors.push(sel);
        if (sel === '[data-testid="copilot-user-message"]') {
          return { length: 3 };
        }
        // Should never reach these — canonical short-circuits.
        return { length: 999 };
      },
    };
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate(fn) {
        const originalDoc = (globalThis as { document?: unknown }).document;
        (globalThis as { document?: unknown }).document = fakeDocument;
        try {
          return fn() as never;
        } finally {
          (globalThis as { document?: unknown }).document = originalDoc;
        }
      },
    };
    expect(await readUserMessageCount(page)).toBe(3);
    // Should NOT have fallen through to the other selectors.
    expect(queriedSelectors).toEqual(['[data-testid="copilot-user-message"]']);
  });

  it("returns 0 on evaluate error", async () => {
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate() {
        throw new Error("page crashed");
      },
    };
    expect(await readUserMessageCount(page)).toBe(0);
  });
});

describe("skipFill turns", () => {
  it("skips fill() and presses Enter after textarea is populated", async () => {
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      // Textarea starts empty, then gets populated (e.g. by preFill
      // triggering voice transcription).
      inputValues: ["", "", "transcribed text"],
      // Assistant settle: 0 → 1 stable.
      evaluateValues: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
      recorded,
    });

    const turns: ConversationTurn[] = [
      {
        input: "(voice transcription)",
        skipFill: true,
        preFill: async () => {
          // In real usage this would click a button that triggers
          // async transcription. The scripted inputValues simulate
          // the textarea being populated after a brief delay.
        },
      },
    ];

    const result = await runConversation(page, turns, {
      assistantSettleMs: 50,
    });

    expect(result.turns_completed).toBe(1);
    expect(result.failure_turn).toBeUndefined();
    expect(result.error).toBeUndefined();
    // fill() must NOT have been called — the whole point of skipFill.
    expect(recorded.fills).toEqual([]);
    // Enter was pressed once to submit the transcribed text.
    expect(recorded.presses).toEqual(["Enter"]);
  });

  it("skipFill turn followed by a normal turn works correctly", async () => {
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      // Textarea pre-populated for turn 1 (skipFill).
      inputValues: ["hello from voice"],
      // Turn 1 settle: 0 → 1, Turn 2 settle: 1 → 2.
      evaluateValues: [
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2,
      ],
      recorded,
    });

    const turns: ConversationTurn[] = [
      { input: "", skipFill: true },
      { input: "follow up question" },
    ];

    const result = await runConversation(page, turns, {
      assistantSettleMs: 50,
    });

    expect(result.turns_completed).toBe(2);
    expect(result.failure_turn).toBeUndefined();
    // Turn 1 skipFill → no fill. Turn 2 normal → fill called.
    expect(recorded.fills).toEqual(["follow up question"]);
    // Turn 1 Enter (from waitForContentAndSend) + Turn 2 Enter
    // (from fillAndVerifySend).
    expect(recorded.presses).toEqual(["Enter", "Enter"]);
    // Drives 2 turns through real settle polling (~1.6s locally); explicit
    // timeout for CI headroom.
  }, 20_000);

  it("skipFill turn times out when textarea stays empty", async () => {
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      // Textarea never gets populated.
      inputValues: [""],
      evaluateValues: [0],
      recorded,
    });

    const turns: ConversationTurn[] = [
      { input: "", skipFill: true, responseTimeoutMs: 200 },
    ];

    const result = await runConversation(page, turns, {
      assistantSettleMs: 50,
    });

    expect(result.turns_completed).toBe(0);
    expect(result.failure_turn).toBe(1);
    expect(result.error).toContain("textarea was not populated");
    // Neither fill nor Enter should have been called.
    expect(recorded.fills).toEqual([]);
    expect(recorded.presses).toEqual([]);
  });

  it("skipFill=false (explicit) behaves like a normal turn", async () => {
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      evaluateValues: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
      recorded,
    });

    const turns: ConversationTurn[] = [
      { input: "normal message", skipFill: false },
    ];

    const result = await runConversation(page, turns, {
      assistantSettleMs: 50,
    });

    expect(result.turns_completed).toBe(1);
    expect(recorded.fills).toEqual(["normal message"]);
    expect(recorded.presses).toEqual(["Enter"]);
  });
});

describe("waitForContentAndSend", () => {
  it("presses Enter immediately when textarea already has content", async () => {
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      inputValues: ["already filled"],
      recorded,
    });

    await waitForContentAndSend(page, "textarea", 1000);

    expect(recorded.presses).toEqual(["Enter"]);
    expect(recorded.fills).toEqual([]);
  });

  it("polls until textarea has content then presses Enter", async () => {
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      inputValues: ["", "", "", "populated after delay"],
      recorded,
    });

    await waitForContentAndSend(page, "textarea", 5000);

    expect(recorded.presses).toEqual(["Enter"]);
    expect(recorded.fills).toEqual([]);
  });

  it("throws when textarea stays empty past timeout", async () => {
    const page = makePage({
      inputValues: [""],
    });

    await expect(waitForContentAndSend(page, "textarea", 200)).rejects.toThrow(
      "textarea was not populated",
    );
  });

  it("throws when page.inputValue is not implemented", async () => {
    // Page without inputValue method — simulates a test fake that
    // doesn't support the optional method.
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate() {
        return 0 as never;
      },
    };

    await expect(waitForContentAndSend(page, "textarea", 1000)).rejects.toThrow(
      "page.inputValue is required",
    );
  });

  it("ignores whitespace-only textarea content", async () => {
    const recorded = { fills: [] as string[], presses: [] as string[] };
    const page = makePage({
      inputValues: ["   ", "  \n  ", "actual content"],
      recorded,
    });

    await waitForContentAndSend(page, "textarea", 5000);

    expect(recorded.presses).toEqual(["Enter"]);
  });
});

describe("readErrorBanner shape handling", () => {
  /**
   * Build a minimal `Page` whose `evaluate` returns a scripted value
   * regardless of what the production reader actually queries. Used to
   * smuggle "unknown shape" / "legacy shape" / "primitive" return values
   * into `readErrorBanner` so we can assert how each branch classifies
   * the raw value coming back from the browser side.
   */
  function pageReturning(raw: unknown): Page {
    return {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate(_fn: () => unknown) {
        return raw as never;
      },
    };
  }

  it("maps an unknown object shape to unreadable (not absent)", async () => {
    const result = await readErrorBanner(pageReturning({ foo: "bar" }));
    expect(result.state).toBe("unreadable");
    if (result.state === "unreadable") {
      expect(result.detail.length).toBeGreaterThan(0);
      expect(result.detail).toContain("unknown shape");
    }
  });

  it("maps a non-object primitive return to unreadable", async () => {
    const result = await readErrorBanner(pageReturning("not an object at all"));
    expect(result.state).toBe("unreadable");
    if (result.state === "unreadable") {
      expect(result.detail.length).toBeGreaterThan(0);
      expect(result.detail).toContain("unknown shape");
    }
  });

  it("maps null return to unreadable", async () => {
    const result = await readErrorBanner(pageReturning(null));
    expect(result.state).toBe("unreadable");
    if (result.state === "unreadable") {
      expect(result.detail.length).toBeGreaterThan(0);
    }
  });

  it("caps detail at <= 200 chars even for objects with many keys", async () => {
    const fat: Record<string, unknown> = {};
    for (let i = 0; i < 200; i++) fat[`key_${i}`] = i;
    const result = await readErrorBanner(pageReturning(fat));
    expect(result.state).toBe("unreadable");
    if (result.state === "unreadable") {
      expect(result.detail.length).toBeLessThanOrEqual(200);
    }
  });

  it("still honours the new {state:'absent'} shape", async () => {
    const result = await readErrorBanner(pageReturning({ state: "absent" }));
    expect(result.state).toBe("absent");
  });

  it("still honours the legacy {visible:false} shape", async () => {
    const result = await readErrorBanner(pageReturning({ visible: false }));
    expect(result.state).toBe("absent");
  });

  it("still honours the legacy {visible:true,text} shape", async () => {
    const result = await readErrorBanner(
      pageReturning({ visible: true, text: "boom" }),
    );
    expect(result.state).toBe("visible");
    if (result.state === "visible") {
      expect(result.text).toBe("boom");
    }
  });
});

// ============================================================
// waitForTurnComplete — data-copilot-running PRIMARY done-signal
// (false-red kill) + done-signal-missing backstop (no false-green)
// ============================================================
//
// BIDIRECTIONAL red-green safety proof for the turn-done-signal fix:
//
//   (1) FALSE-RED KILLED: a healthy turn where the SSE fetch-counter NEVER
//       increments (the fragile signal the flap blames) but the
//       `data-copilot-running` attribute goes true→false and the bubble is
//       stable+non-empty → completes GREEN via the DOM transition.
//   (2) REAL BREAK STILL RED (no false-green): the silent multi-step hang —
//       bubble #1 paints + text settles but running stays stuck `true` (or
//       clears without a stop edge for this turn) and the SSE counter never
//       catches up → REDS via the `done-signal-missing` backstop.
//   (2b) MULTI-STEP INTERMEDIATE FALSE: running toggles
//       false→true→false→true→… between sub-runs → does NOT complete on the
//       first (intermediate) false; only the final stop completes.
//   (3) HEADLESS FALLBACK: attribute absent → completes via the SSE counter.
//
// These build a fake `page` whose `evaluate` dispatches the THREE reads
// `waitForTurnComplete` makes per poll — `__hk_runsFinished` (SSE counter),
// `__hk_copilotRunning` (run-lifecycle summary), and the atomic cascade
// `{ count, text }` — each from a per-poll script array (last value repeats
// so a "settled tail" models trivially). REAL timers; tiny settle window.
/** Pull element `i` from `arr`, clamping to the last (steady-state tail). */
function clampAt<T>(arr: T[], i: number): T {
  if (arr.length === 0) throw new Error("empty script array");
  return arr[Math.min(i, arr.length - 1)]!;
}

describe("waitForTurnComplete — data-copilot-running done-signal", () => {
  const at = clampAt;

  /**
   * Build a fake Page that scripts the three per-poll reads independently.
   * `poll` counts cascade reads (the once-per-iteration anchor); SSE +
   * running reads sample the SAME poll index so all three advance together.
   */
  function makeRunSignalPage(script: {
    sse: number[];
    running: CopilotRunningState[];
    cascade: Array<{ count: number; text: string | null }>;
  }): Page {
    let cascadePoll = 0;
    return {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate(fn: () => unknown) {
        const body = fn.toString();
        if (body.includes("copilot-user-message")) return 1 as never;
        if (body.includes("__hk_runsFinished")) {
          return at(script.sse, cascadePoll) as never;
        }
        if (body.includes("__hk_copilotRunning")) {
          return at(script.running, cascadePoll) as never;
        }
        if (body.includes("copilot-error-banner")) {
          return { state: "absent" } as never;
        }
        // Atomic cascade read — the once-per-poll anchor that advances the
        // shared poll index.
        if (
          body.includes("querySelectorAll") &&
          body.includes("textContent") &&
          body.includes("{ count")
        ) {
          const v = at(script.cascade, cascadePoll);
          cascadePoll += 1;
          return v as never;
        }
        // countAssistantMessages (post-loop classifier) — return the last
        // cascade count.
        return at(script.cascade, cascadePoll).count as never;
      },
    };
  }

  /**
   * Surface-mount variant of `makeRunSignalPage`. Scripts the THREE per-poll
   * reads (sse / running / cascade) PLUS a per-poll surface-mounted boolean,
   * and returns a `{ page, surfaceReady }` pair. `waitForTurnComplete` calls
   * `surfaceReady(page)` EXACTLY ONCE per loop iteration, so we key the
   * surface script off an INDEPENDENT call counter rather than the page's
   * cascade-poll index (the loop reads surface AFTER the cascade read, which
   * already advanced the cascade index — keying off call ordinals keeps
   * `surface[i]` aligned to the i-th loop iteration without an off-by-one).
   * This lets the surface-mount completion path be exercised against scripted
   * run-lifecycle toggles — the exact shape the F4 quiescence fix governs.
   */
  function makeSurfaceRunSignalPage(script: {
    sse: number[];
    running: CopilotRunningState[];
    cascade: Array<{ count: number; text: string | null }>;
    surface: boolean[];
  }): { page: Page; surfaceReady: (page: Page) => Promise<boolean> } {
    let cascadePoll = 0;
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate(fn: () => unknown) {
        const body = fn.toString();
        if (body.includes("copilot-user-message")) return 1 as never;
        if (body.includes("__hk_runsFinished")) {
          return at(script.sse, cascadePoll) as never;
        }
        if (body.includes("__hk_copilotRunning")) {
          return at(script.running, cascadePoll) as never;
        }
        if (body.includes("copilot-error-banner")) {
          return { state: "absent" } as never;
        }
        if (
          body.includes("querySelectorAll") &&
          body.includes("textContent") &&
          body.includes("{ count")
        ) {
          const v = at(script.cascade, cascadePoll);
          cascadePoll += 1;
          return v as never;
        }
        return at(script.cascade, cascadePoll).count as never;
      },
    };
    let surfaceCall = 0;
    const surfaceReady = async (): Promise<boolean> => {
      const v = at(script.surface, surfaceCall);
      surfaceCall += 1;
      return v;
    };
    return { page, surfaceReady };
  }

  const runningAbsent: CopilotRunningState = {
    attrPresent: false,
    runningNow: null,
    sawRunningTrue: false,
    runStartCount: 0,
    lastStoppedAtMs: 0,
  };
  const runningStarted: CopilotRunningState = {
    attrPresent: true,
    runningNow: true,
    sawRunningTrue: true,
    runStartCount: 1,
    lastStoppedAtMs: 0,
  };
  const runningStopped: CopilotRunningState = {
    attrPresent: true,
    runningNow: false,
    sawRunningTrue: true,
    runStartCount: 1,
    lastStoppedAtMs: 1,
  };

  it("(1) FALSE-RED KILLED: SSE counter never increments but data-copilot-running goes true→false → completes GREEN via DOM signal", async () => {
    // The fragile fetch-counter NEVER catches up (stays 0 — the exact flap
    // condition). The ONLY done-signal is the DOM transition. A bubble with
    // stable non-empty text + the true→false edge must complete GREEN.
    const page = makeRunSignalPage({
      sse: [0], // counter never increments — the false-red trigger
      running: [
        runningAbsent, // baseline read (turn entry)
        runningStarted, // run in flight
        runningStopped, // RUN_FINISHED → true→false transition
        runningStopped,
        runningStopped,
      ],
      cascade: [
        { count: 1, text: "hello there" },
        { count: 1, text: "hello there" },
        { count: 1, text: "hello there" }, // text stable + non-empty
      ],
    });
    const result = await waitForTurnComplete({
      page,
      turnIndex: 1,
      settleMs: 30,
      timeoutMs: 5_000,
      maxTurnDurationMs: 2_000,
      baselineCount: 0,
    });
    expect(result.text).toBe("hello there");
  });

  it("(1-fast) FAST-TURN FALSE-RED KILLED: RUN_STARTED fires BEFORE the baseline read; pre-send baselineRunStartCount threaded via opts lets the true→false transition complete GREEN", async () => {
    // F2 regression guard. The PRIMARY done-signal gates on
    // `runStartCount > baselineRunStartCount`. If the run-start baseline is
    // captured INSIDE waitForTurnComplete (after the message was sent), a fast
    // agent that fires RUN_STARTED between the send and that read makes the
    // baseline already-incremented (runStartCount=1), so
    // `1 > 1` can NEVER hold → the PRIMARY DOM signal is DEAD and the turn
    // must fall back to the SSE counter (which here never catches up) → it
    // reds via the done-signal-missing backstop. The fix captures the
    // run-start baseline at the CALL SITE BEFORE sendTurnMessage (runStartCount
    // = 0, before the agent started) and threads it via
    // `opts.baselineRunStartCount`. With the pre-send baseline of 0, the
    // observed runStartCount=1 satisfies `1 > 0` → the true→false transition
    // completes GREEN. The SSE counter stays 0 throughout, proving completion
    // is driven SOLELY by the DOM transition.
    const page = makeRunSignalPage({
      sse: [0], // fragile counter never catches up — DOM signal is the only path
      running: [
        // Baseline read (turn entry) ALREADY shows a started run: the fast
        // agent fired RUN_STARTED before this read could run. runStartCount=1.
        runningStarted,
        runningStarted, // run in flight
        runningStopped, // RUN_FINISHED → true→false transition (runStartCount=1)
        runningStopped,
        runningStopped,
      ],
      cascade: [
        { count: 1, text: "fast reply" },
        { count: 1, text: "fast reply" },
        { count: 1, text: "fast reply" }, // text stable + non-empty
      ],
    });
    const result = await waitForTurnComplete({
      page,
      turnIndex: 1,
      settleMs: 30,
      timeoutMs: 5_000,
      maxTurnDurationMs: 2_000,
      baselineCount: 0,
      // The TRUE pre-send baseline (captured at the call site before the agent
      // started). On UNMODIFIED source this opt does not exist and the
      // in-function read captures runStartCount=1 → primary signal dies → the
      // turn reds via the backstop. With the fix, this 0 makes `1 > 0` hold.
      baselineRunStartCount: 0,
    });
    expect(result.text).toBe("fast reply");
  });

  it("(2) REAL BREAK STILL RED: silent multi-step hang (bubble painted + text settled, running STUCK TRUE, SSE never catches up) → done-signal-missing at the HARD timeout", async () => {
    // Bubble #1 paints, text settles, but the run NEVER finishes: running
    // stays `true` forever AND the SSE counter never catches up. DOM+text
    // hold, yet there is NO trustworthy done-signal → must RED (NOT green on
    // DOM+text alone).
    //
    // NOTE (F4): the `done-signal-missing` BACKSTOP is now gated on
    // `runningNow !== true` — it must never red a turn that is still
    // legitimately running. A run STUCK `true` therefore no longer reds at
    // `maxTurnDurationMs`; it reds at the HARD `timeoutMs` via the post-loop
    // classifier instead (still `done-signal-missing`: attrPresent + a bubble
    // + no stop edge for this turn). The backstop's job is the
    // painted-and-settled-but-finished-signal-missing case where the run is
    // NOT currently running — see (2-stopped) below. We use a small
    // `timeoutMs` so the hard-ceiling red fires fast in-test.
    const page = makeRunSignalPage({
      sse: [0], // never catches up
      running: [
        runningAbsent, // baseline
        runningStarted, // stuck running forever (no stop edge ever)
      ],
      cascade: [{ count: 1, text: "partial answer..." }],
    });
    await expect(
      waitForTurnComplete({
        page,
        turnIndex: 1,
        settleMs: 30,
        timeoutMs: 400, // hard ceiling — the stuck-true hang reds here
        maxTurnDurationMs: 200, // backstop is suppressed while runningNow===true
        baselineCount: 0,
      }),
    ).rejects.toMatchObject({
      name: "TurnNotCompleteError",
      reason: "done-signal-missing",
    });
  });

  it("(2-stopped) BACKSTOP STILL REDS: silent hang where the run has STOPPED (runningNow=false) but the done-signal never confirms → done-signal-missing backstop fires before the hard ceiling", async () => {
    // The backstop's legitimate job after the F4 runningNow guard: a turn
    // whose bubble painted + text settled and whose run is NOT currently
    // running, yet no trustworthy done-signal ever confirms. Here the DOM
    // attribute is present and `runningNow` is false, BUT no run ever started
    // THIS turn (runStartCount stays at the baseline 0), so `sawStopThisTurn`
    // never holds → no stayed-stopped quiescence → `doneSignalOk` stays false.
    // With the run not running, the backstop must RED it at
    // `maxTurnDurationMs` (well before the hard `timeoutMs`), proving the
    // runningNow guard did not neuter the backstop for genuinely-stopped
    // hangs.
    const stoppedNoRunThisTurn: CopilotRunningState = {
      attrPresent: true,
      runningNow: false,
      sawRunningTrue: true,
      runStartCount: 0, // NOT > baseline (0) → sawStopThisTurn never holds
      lastStoppedAtMs: 1,
    };
    const page = makeRunSignalPage({
      sse: [0], // never catches up
      running: [runningAbsent, stoppedNoRunThisTurn],
      cascade: [{ count: 1, text: "partial answer..." }],
    });
    await expect(
      waitForTurnComplete({
        page,
        turnIndex: 1,
        settleMs: 30,
        timeoutMs: 5_000,
        maxTurnDurationMs: 300, // backstop fires well before the hard ceiling
        baselineCount: 0,
      }),
    ).rejects.toMatchObject({
      name: "TurnNotCompleteError",
      reason: "done-signal-missing",
    });
  });

  it("(2-empty) REAL BREAK STILL RED: empty/never-rendered bubble → dom-missing (never completes)", async () => {
    // No new bubble for this turn (count never exceeds baseline). The run
    // even reports a stop, but with nothing rendered the turn is a failure,
    // classified dom-missing.
    const page = makeRunSignalPage({
      sse: [1],
      running: [runningAbsent, runningStopped],
      cascade: [{ count: 0, text: null }],
    });
    await expect(
      waitForTurnComplete({
        page,
        turnIndex: 1,
        settleMs: 30,
        timeoutMs: 800,
        maxTurnDurationMs: 800,
        baselineCount: 0,
      }),
    ).rejects.toMatchObject({
      name: "TurnNotCompleteError",
      reason: "dom-missing",
    });
  });

  it("(2b) MULTI-STEP INTERMEDIATE FALSE: running false→true→false→true→false does NOT complete on the intermediate false; only the final stop completes", async () => {
    // A multi-step turn: sub-run 1 starts (true), finishes (false), sub-run 2
    // starts (true), finishes (false). The gate must NOT complete on the
    // INTERMEDIATE false (runStartCount=1, a new run about to start) — it
    // completes only on the final stop. We model the "new run started after
    // the first stop" by bumping runStartCount on the re-start; the
    // intermediate-false poll has runningNow=false but is immediately
    // followed by a re-start, and crucially the FINAL stop has
    // runStartCount=2 with runningNow=false.
    const intermediateStop: CopilotRunningState = {
      attrPresent: true,
      runningNow: false,
      sawRunningTrue: true,
      runStartCount: 1,
      lastStoppedAtMs: 1,
    };
    const restarted: CopilotRunningState = {
      attrPresent: true,
      runningNow: true,
      sawRunningTrue: true,
      runStartCount: 2,
      lastStoppedAtMs: 1,
    };
    const finalStop: CopilotRunningState = {
      attrPresent: true,
      runningNow: false,
      sawRunningTrue: true,
      runStartCount: 2,
      lastStoppedAtMs: 2,
    };
    // SSE counter never catches up so completion is driven SOLELY by the DOM
    // transition — proving the gate waits for the FINAL stop.
    const page = makeRunSignalPage({
      sse: [0],
      running: [
        runningAbsent, // baseline (runStartCount=0)
        runningStarted, // sub-run 1 running
        intermediateStop, // sub-run 1 done — but more work coming
        restarted, // sub-run 2 running
        finalStop, // sub-run 2 done — THIS is the real completion
        finalStop,
        finalStop,
      ],
      cascade: [
        { count: 1, text: "step 1 output" },
        { count: 2, text: "step 1 output" },
        { count: 2, text: "final answer" },
        { count: 2, text: "final answer" },
        { count: 2, text: "final answer" }, // stable on the final stop
      ],
    });
    const result = await waitForTurnComplete({
      page,
      turnIndex: 1,
      settleMs: 30,
      timeoutMs: 5_000,
      maxTurnDurationMs: 4_000,
      baselineCount: 0,
    });
    // Completed on the FINAL answer, not the intermediate step-1 text.
    expect(result.text).toBe("final answer");
  });

  it("(2c) MULTI-STEP SSE OR-TRIGGER MUST NOT FALSE-GREEN: DOM signal present, sub-run 2 already RUNNING (no stop edge this poll) but SSE counter caught up at the intermediate stop + intermediate text settled → must NOT complete early; only the final stop completes", async () => {
    // The cardinal false-GREEN this branch kills. On a multi-step turn the
    // page-side RUN_FINISHED fetch-counter increments once per SUB-RUN, so
    // after sub-run 1 finishes `runsFinished` already reaches 1 ≥ turnIndex 1
    // → `sseOk` is true for the REST of the turn. With the old
    // `doneSignalOk = domSignalAvailable ? sawStopThisTurn || sseOk : sseOk`,
    // the `|| sseOk` disjunct lets that stale counter SOLELY satisfy the
    // done-signal even when the trustworthy DOM transition says "a new run is
    // in flight" (sub-run 2 already RUNNING → `sawStopThisTurn` false). If the
    // intermediate bubble's text also momentarily settles, the gate completes
    // EARLY on the intermediate answer — defeating the multi-step safety. The
    // fix makes the DOM transition the SOLE done-signal whenever it's
    // available, so the gate waits for the FINAL stop.
    //
    // Modelled poll-by-poll (note `makeRunSignalPage` advances its shared poll
    // index only on the cascade read, and the pre-loop baseline read consumes
    // `running[0]` WITHOUT advancing — so loop poll i reads running[i],
    // sse[i], cascade[i], with poll 0 re-reading running[0]):
    //   baseline + poll 0 : sub-run 1 running (sse 0)
    //   poll 1            : sub-run 1 still running, intermediate text appears
    //   poll 2 (THE TRAP) : sub-run 2 ALREADY RESTARTED — runningNow=true,
    //                       runStartCount=2, BUT sse has caught up to 1
    //                       (sub-run 1's RUN_FINISHED already counted), the
    //                       intermediate bubble exists, and its text has been
    //                       stable for settleMs. sawStopThisTurn is FALSE here
    //                       (runningNow=true), so the ONLY thing that could
    //                       complete this poll is the stale `|| sseOk`.
    //   poll 3+           : sub-run 2 finishes — the REAL final stop.
    const subRun1Running: CopilotRunningState = {
      attrPresent: true,
      runningNow: true,
      sawRunningTrue: true,
      runStartCount: 1,
      lastStoppedAtMs: 0,
    };
    // Sub-run 2 is ALREADY running again by the time we poll after sub-run 1's
    // RUN_FINISHED bumped the SSE counter — so this poll has NO stop edge
    // (runningNow=true) yet sseOk is true. This is the poll that false-greens
    // under the old OR-trigger.
    const subRun2RunningWithSseCaughtUp: CopilotRunningState = {
      attrPresent: true,
      runningNow: true,
      sawRunningTrue: true,
      runStartCount: 2,
      lastStoppedAtMs: 1,
    };
    const finalStop: CopilotRunningState = {
      attrPresent: true,
      runningNow: false,
      sawRunningTrue: true,
      runStartCount: 2,
      lastStoppedAtMs: 2,
    };
    const page = makeRunSignalPage({
      // SSE catches up to 1 at poll 2 (sub-run 1's RUN_FINISHED is now
      // counted) and STAYS there — the stale counter the old `|| sseOk`
      // would trust.
      sse: [0, 0, 1, 1, 1, 1, 1],
      running: [
        runningAbsent, // baseline + poll 0 (runStartCount=0 → no sawStop)
        subRun1Running, // poll 1: sub-run 1 in flight
        subRun2RunningWithSseCaughtUp, // poll 2: THE TRAP — sub-run 2 running, sse=1, text settled
        finalStop, // poll 3: sub-run 2 done — the REAL completion
        finalStop,
        finalStop,
        finalStop,
      ],
      cascade: [
        // Intermediate bubble appears at poll 1 with "intermediate answer" and
        // is identical at poll 2 — so by poll 2 it has been stable for the full
        // poll cadence (>= settleMs=10), arming domOk + thirdOk at the EXACT
        // poll where the stale sseOk would trigger.
        { count: 2, text: null }, // poll 0: no bubble text yet
        { count: 2, text: "intermediate answer" }, // poll 1: intermediate text appears
        { count: 2, text: "intermediate answer" }, // poll 2: settled — THE TRAP poll
        { count: 2, text: "final answer" }, // poll 3: final text arrives
        { count: 2, text: "final answer" },
        { count: 2, text: "final answer" }, // stable on the final stop
      ],
    });
    const result = await waitForTurnComplete({
      page,
      turnIndex: 1,
      settleMs: 10,
      timeoutMs: 5_000,
      maxTurnDurationMs: 4_000,
      baselineCount: 0,
    });
    // Must complete on the FINAL answer, never the intermediate one. Under the
    // old OR-trigger this returned "intermediate answer" (false-GREEN).
    expect(result.text).toBe("final answer");
  });

  it("(3) HEADLESS FALLBACK: attribute absent → completes via the SSE counter", async () => {
    // A headless bring-your-own-UI demo never renders CopilotChatView, so
    // `data-copilot-running` is absent (attrPresent=false). The done-signal
    // falls back to the SSE counter, which catches up → completes GREEN.
    const page = makeRunSignalPage({
      sse: [0, 1, 1], // counter catches up by poll 2
      running: [runningAbsent], // attribute never present
      cascade: [
        { count: 1, text: "headless reply" },
        { count: 1, text: "headless reply" },
        { count: 1, text: "headless reply" },
      ],
    });
    const result = await waitForTurnComplete({
      page,
      turnIndex: 1,
      settleMs: 30,
      timeoutMs: 5_000,
      maxTurnDurationMs: 2_000,
      baselineCount: 0,
    });
    expect(result.text).toBe("headless reply");
  });

  it("(3-red) HEADLESS REAL BREAK: attribute absent AND SSE counter never catches up → sse-missing at the HARD timeout (NOT early via the backstop)", async () => {
    // Headless demo whose run never finishes: no DOM signal AND the SSE
    // counter never catches up, but a bubble painted + settled. The early
    // `done-signal-missing` backstop is gated on `attrPresent === true` (F5):
    // a headless turn has NO authoritative signal that can be "missing", so it
    // is NOT redded early at `maxTurnDurationMs`. A genuinely-stuck headless
    // turn still REDS — at the HARD `timeoutMs` via the post-loop classifier,
    // classified `sse-missing` (the SSE counter is the headless done-signal and
    // it never caught up). Tiny `timeoutMs` so the hard-ceiling path is fast.
    const page = makeRunSignalPage({
      sse: [0], // never catches up
      running: [runningAbsent],
      cascade: [{ count: 1, text: "stuck headless" }],
    });
    await expect(
      waitForTurnComplete({
        page,
        turnIndex: 1,
        settleMs: 30,
        timeoutMs: 300,
        maxTurnDurationMs: 100,
        baselineCount: 0,
      }),
    ).rejects.toMatchObject({
      name: "TurnNotCompleteError",
      reason: "sse-missing",
    });
  });

  it("(F3) SURFACE-READ ATOMICITY: `surfaceReady(page)` is evaluated AT MOST ONCE per poll (no wasted/non-atomic double DOM round-trip)", async () => {
    // Regression for the duplicated per-poll `surfaceReady(page)` read. The
    // buggy gate evaluated the live surface DOM state TWICE on any poll where
    // the done-signal + DOM held but the surface had NOT yet mounted: once
    // for the main-completion conjunct `thirdOk`
    // (`doneSignalOk && domOk && await surfaceReady(page)` → false, so the
    // completion `if` is skipped) and AGAIN for the backstop conjunct
    // `thirdConjunctHeld` (`await surfaceReady(page)`), discarding the second
    // result. That doubled the per-poll surface `page.evaluate` round-trips
    // and made the two conjuncts read DIFFERENT live values if the surface
    // mounted between the two reads (a latent disagreement hazard).
    //
    // RED PROOF: a counting `surfaceReady` records how many times it is
    // invoked PER POLL (correlated to the once-per-poll cascade read via the
    // shared `cascadePoll` the fake exposes through the script tail). On the
    // first poll the done-signal (SSE counter) + DOM hold but the surface is
    // NOT mounted, so the UNMODIFIED two-read source invokes `surfaceReady`
    // TWICE that poll; the surface mounts on the next poll and completes.
    // With the single-read fix every poll invokes `surfaceReady` AT MOST
    // ONCE. We assert the per-poll maximum is 1 — FAILS on the two-read
    // source (records 2 on the first poll), PASSES after the fix.
    //
    // `runStoppedThisTurn` keeps the DOM run-attribute present and reports a
    // completed stop transition for THIS turn (`sawRunningTrue` + a started
    // run + `runningNow === false`), so the DOM done-signal — the SOLE
    // done-signal when the attribute is present — is satisfied from poll 1.
    // That makes `doneSignalOk` TRUE from poll 1, which is exactly the
    // condition that gates the FIRST (`thirdOk`) surface read on.
    // Surface-not-yet-mounted on poll 1 then forces the SECOND (backstop)
    // read on the buggy two-read source. (Note: a DOM transition is used here
    // rather than the SSE counter because when the run attribute is present
    // the SSE counter is no longer an OR-trigger for the done-signal.)
    const runStoppedThisTurn: CopilotRunningState = {
      attrPresent: true,
      runningNow: false,
      sawRunningTrue: true, // saw running then stopped → DOM done-signal fires
      runStartCount: 1, // > baseline (0) → a run started THIS turn
      lastStoppedAtMs: 0,
    };
    // A self-contained fake whose cascade read (the once-per-poll anchor)
    // bumps a shared `pollIndex`. `surfaceReady` records the `pollIndex` of
    // every invocation, so we can deterministically count how many times the
    // gate read the surface WITHIN a single poll — no timers, no races.
    let pollIndex = 0;
    const surfaceCallsByPoll: number[] = []; // surfaceCallsByPoll[p] = reads on poll p
    let mounted = false;
    const sse = 1; // headless fallback only; irrelevant here (DOM signal present)
    const cascade = { count: 1, text: "surface turn" as string | null };
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate(fn: () => unknown) {
        const body = fn.toString();
        if (body.includes("copilot-user-message")) return 1 as never;
        if (body.includes("__hk_runsFinished")) return sse as never;
        if (body.includes("__hk_copilotRunning"))
          return runStoppedThisTurn as never;
        if (body.includes("copilot-error-banner"))
          return { state: "absent" } as never;
        if (
          body.includes("querySelectorAll") &&
          body.includes("textContent") &&
          body.includes("{ count")
        ) {
          // Once-per-poll anchor: advance the poll index. The surface mounts
          // starting on poll 2 so poll 1 stays unmounted (forcing the buggy
          // second read), and poll 2 completes via the main conjunct.
          pollIndex += 1;
          if (pollIndex >= 2) mounted = true;
          return cascade as never;
        }
        return cascade.count as never;
      },
    };
    const surfaceReady = async (): Promise<boolean> => {
      surfaceCallsByPoll[pollIndex] = (surfaceCallsByPoll[pollIndex] ?? 0) + 1;
      return mounted;
    };
    const result = await waitForTurnComplete({
      page,
      turnIndex: 1,
      settleMs: 10,
      timeoutMs: 5_000,
      maxTurnDurationMs: 5_000,
      baselineCount: 0,
      // Pre-send run-start baseline of 0 so the fake's runStartCount=1 clears
      // it (`1 > 0`) and the DOM stop transition — the SOLE done-signal when
      // the run attribute is present — fires from poll 1.
      baselineRunStartCount: 0,
      pollIntervalMs: 5,
      surfaceReady,
    });
    expect(result.text).toBe("surface turn");
    // The defect: the buggy source reads the surface TWICE on the poll where
    // the done-signal holds but the surface is unmounted (poll 1). The fix
    // reads it AT MOST ONCE per poll. (Index 0 is the pre-loop baseline-read
    // window before the first cascade advance; surfaceReady is never called
    // there, so the meaningful counts live at index >= 1.)
    const perPollCounts = Array.from(surfaceCallsByPoll, (n) => n ?? 0);
    const maxCallsInAnyPoll = Math.max(0, ...perPollCounts);
    expect(maxCallsInAnyPoll).toBeLessThanOrEqual(1);
    // Sanity: the surface WAS read (the test actually exercised the path).
    expect(perPollCounts.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  // ==========================================================
  // F4 — surface-mount STAYED-STOPPED quiescence (close BOTH the
  // false-GREEN on a transient intermediate stop AND the false-RED
  // backstop on a still-running gen-UI turn)
  // ==========================================================

  it("(F4-1) FALSE-GREEN KILLED: a MULTI-STEP completeOnMount turn does NOT complete on a transient INTERMEDIATE stop (surface mounted early); it completes only after the FINAL stop STAYS stopped", async () => {
    // The cardinal false-green for the surface path. On a multi-step
    // `completeOnMount` turn the render surface can mount during an EARLY
    // sub-run. At the FIRST intermediate stop between sub-runs the old gate
    // saw: sawStopThisTurn (a momentary runningNow=false edge), domOk (a
    // bubble exists), surfaceMounted (surface already rendered) →
    // `thirdOk = doneSignalOk && domOk && surfaceMounted` true → it RETURNED
    // EARLY, before the final sub-run ran. The probe reported the turn
    // complete when it wasn't.
    //
    // The fix requires the stop to have STAYED stopped (no newer run-start
    // for the settle window) before completion can fire — so the transient
    // intermediate stop cannot green the turn. NOTE the page-fake convention:
    // the pre-loop baseline-run-start read consumes running[0] WITHOUT
    // advancing the shared poll index, so loop iteration `i` reads
    // running[i] / cascade[i] / surface[i] and running[0] is BOTH the baseline
    // AND iteration 0 (so real run states begin at index 1). We model:
    //   i1 sub-run 1 running, surface not yet mounted
    //   i2 sub-run 1 running, surface MOUNTS (early gen-UI paint)
    //   i3 INTERMEDIATE stop (runningNow=false, runStartCount=1) — THE TRAP:
    //      surface mounted, bubble present (count=1), momentary stop edge
    //   i4 sub-run 2 RE-STARTS (runningNow=true, runStartCount=2), count→2
    //   i5 FINAL stop (runningNow=false, runStartCount=2)
    //   i6 FINAL stop holds → quiescence satisfied → completes here
    //
    // bubbleIndex discriminates: a false-green at the intermediate stop
    // returns count=1 → bubbleIndex 0; the correct completion at the final
    // stop has count=2 → bubbleIndex 1. On UNMODIFIED source this returns
    // bubbleIndex 0 (early); after the fix it returns bubbleIndex 1.
    const intermediateStop: CopilotRunningState = {
      attrPresent: true,
      runningNow: false,
      sawRunningTrue: true,
      runStartCount: 1,
      lastStoppedAtMs: 1,
    };
    const restarted: CopilotRunningState = {
      attrPresent: true,
      runningNow: true,
      sawRunningTrue: true,
      runStartCount: 2,
      lastStoppedAtMs: 1,
    };
    const finalStop: CopilotRunningState = {
      attrPresent: true,
      runningNow: false,
      sawRunningTrue: true,
      runStartCount: 2,
      lastStoppedAtMs: 2,
    };
    const { page, surfaceReady } = makeSurfaceRunSignalPage({
      sse: [0], // DOM transition is the SOLE done-signal here
      running: [
        runningAbsent, // baseline + i0 (runStartCount=0 → no sawStop)
        runningStarted, // i1: sub-run 1 running
        runningStarted, // i2: still running, surface mounts this poll
        intermediateStop, // i3: THE TRAP — intermediate stop, surface mounted
        restarted, // i4: sub-run 2 running again (count→2)
        finalStop, // i5: final stop
        finalStop, // i6: final stop holds → quiescent
        finalStop,
      ],
      cascade: [
        { count: 1, text: null }, // i0
        { count: 1, text: null }, // i1
        { count: 1, text: null }, // i2
        { count: 1, text: null }, // i3 (intermediate bubble — count=1)
        { count: 2, text: null }, // i4 (sub-run 2's bubble appears — count=2)
        { count: 2, text: null }, // i5 (final bubble)
        { count: 2, text: null }, // i6
        { count: 2, text: null },
      ],
      surface: [
        false, // i0: surface not mounted yet
        false, // i1: still not mounted
        true, // i2: surface MOUNTS during sub-run 1
        true, // i3: still mounted (THE TRAP poll)
        true, // i4
        true, // i5
        true, // i6
        true,
      ],
    });
    const result = await waitForTurnComplete({
      page,
      turnIndex: 1,
      settleMs: 15,
      timeoutMs: 5_000,
      maxTurnDurationMs: 4_000,
      baselineCount: 0,
      baselineRunStartCount: 0,
      pollIntervalMs: 5,
      surfaceReady,
    });
    // Completed on the FINAL bubble (count=2 → bubbleIndex 1), NOT the
    // intermediate stop's bubble (count=1 → bubbleIndex 0). On unmodified
    // source this is 0 (false-green at the intermediate stop).
    expect(result.bubbleIndex).toBe(1);
  });

  it("(F4-2) FALSE-RED KILLED: a completeOnMount turn whose surface mounts WHILE the run is still going does NOT throw done-signal-missing while running (backstop gated on runningNow !== true)", async () => {
    // The false-red symptom. A gen-UI turn paints its surface early and the
    // run is STILL going (runningNow=true). The `done-signal-missing`
    // backstop fires once `maxTurnDurationMs` elapses with DOM + the third
    // conjunct (surface) held but no confirmed done-signal — and the OLD
    // backstop had NO `runningNow` guard, so it RED a turn that was simply
    // still legitimately running (its stop edge lands after
    // `maxTurnDurationMs` but before `timeoutMs`).
    //
    // We hold the run RUNNING (runningNow=true) past `maxTurnDurationMs` with
    // the surface mounted + bubble present, then let it stop and stay
    // stopped. The fixed backstop must NOT fire while runningNow===true, so
    // the turn completes GREEN on the eventual quiescent stop instead of
    // throwing. On UNMODIFIED source the backstop throws done-signal-missing
    // around `maxTurnDurationMs` while the run is still in flight.
    const finalStop: CopilotRunningState = {
      attrPresent: true,
      runningNow: false,
      sawRunningTrue: true,
      runStartCount: 1,
      lastStoppedAtMs: 1,
    };
    // maxTurnDurationMs=40 with pollIntervalMs=5 → the backstop window
    // (~8 polls) elapses while the run is still running (the long
    // runningStarted tail), so the OLD unguarded backstop reds mid-run.
    const { page, surfaceReady } = makeSurfaceRunSignalPage({
      sse: [0], // SSE never catches up; DOM transition is the sole done-signal
      running: [
        runningAbsent, // baseline
        // Run stays RUNNING for many polls past maxTurnDurationMs (40ms /
        // 5ms ≈ 8 polls); keep it running well beyond that, THEN stop.
        runningStarted, // i0
        runningStarted, // i1
        runningStarted, // i2
        runningStarted, // i3
        runningStarted, // i4
        runningStarted, // i5
        runningStarted, // i6
        runningStarted, // i7
        runningStarted, // i8
        runningStarted, // i9
        runningStarted, // i10
        finalStop, // i11: run finally stops
        finalStop, // i12: stays stopped → quiescent → completes
        finalStop,
      ],
      cascade: Array.from({ length: 15 }, () => ({
        count: 1,
        text: null as string | null,
      })),
      surface: Array.from({ length: 15 }, () => true), // surface mounted from i0
    });
    // Must NOT reject. On unmodified source this REJECTS (done-signal-missing
    // backstop fires while runningNow===true).
    const result = await waitForTurnComplete({
      page,
      turnIndex: 1,
      settleMs: 15,
      timeoutMs: 5_000,
      maxTurnDurationMs: 40, // << timeoutMs, fires well before the hard ceiling
      baselineCount: 0,
      baselineRunStartCount: 0,
      pollIntervalMs: 5,
      surfaceReady,
    });
    expect(result.bubbleIndex).toBe(0);
  });

  it("(F4-3a) REGRESSION: a SINGLE-run completeOnMount happy path still completes once the surface mounts and the stop STAYS stopped", async () => {
    // Guards against the quiescence gate over-tightening: a normal single-run
    // gen-UI turn (run starts, stops once, stays stopped; surface mounts)
    // MUST still complete after the surface mounts + the stop persists.
    const { page, surfaceReady } = makeSurfaceRunSignalPage({
      sse: [0],
      running: [
        runningAbsent, // baseline
        runningStarted, // i0: running
        runningStopped, // i1: stop (runStartCount=1)
        runningStopped, // i2: stays stopped → quiescent
        runningStopped,
        runningStopped,
      ],
      cascade: [
        { count: 1, text: null },
        { count: 1, text: null },
        { count: 1, text: null },
        { count: 1, text: null },
      ],
      surface: [false, true, true, true, true, true], // surface mounts at i1
    });
    const result = await waitForTurnComplete({
      page,
      turnIndex: 1,
      settleMs: 15,
      timeoutMs: 5_000,
      maxTurnDurationMs: 4_000,
      baselineCount: 0,
      baselineRunStartCount: 0,
      pollIntervalMs: 5,
      surfaceReady,
    });
    expect(result.bubbleIndex).toBe(0);
  });

  it("(F4-3b) REGRESSION: a genuine HEADLESS surface hang (bubble + surface mounted, runningNow=null, done-signal never confirmed) REDS as sse-missing at the HARD timeout (NOT early via the backstop)", async () => {
    // A painted + surface-mounted-but-finished-signal-missing case on the
    // HEADLESS path (attribute absent → no DOM transition; SSE counter never
    // catches up). The early `done-signal-missing` backstop is gated on
    // `attrPresent === true` (F5), so a headless turn is NOT redded early at
    // `maxTurnDurationMs` — it would be a false-red on a merely-lagging SSE
    // counter. A GENUINELY-stuck headless turn still REDS, at the HARD
    // `timeoutMs` via the post-loop classifier, classified `sse-missing`. (The
    // DOM-present equivalent of this surface hang is covered by F4-3c below,
    // which keeps the early `done-signal-missing` backstop behaviour.)
    const { page, surfaceReady } = makeSurfaceRunSignalPage({
      sse: [0], // never catches up
      running: [runningAbsent], // attribute absent → runningNow null (not true)
      cascade: [{ count: 1, text: null }],
      surface: [true], // surface mounted the whole time
    });
    await expect(
      waitForTurnComplete({
        page,
        turnIndex: 1,
        settleMs: 15,
        timeoutMs: 200, // tiny hard ceiling so the timeout path is fast
        maxTurnDurationMs: 60, // would have fired here on the old (ungated) backstop
        baselineCount: 0,
        baselineRunStartCount: 0,
        pollIntervalMs: 5,
        surfaceReady,
      }),
    ).rejects.toMatchObject({
      name: "TurnNotCompleteError",
      reason: "sse-missing",
    });
  });

  it("(F4-3c) REGRESSION: a genuine DOM-PRESENT surface hang (bubble + surface mounted, runningNow=false, done-signal never confirmed) still REDS EARLY via the done-signal-missing backstop", async () => {
    // The early backstop's preserved DOM-present job: a turn whose DOM signal
    // IS available (attribute present, run stopped: runningNow=false) but where
    // no run ever started for this turn (runStartCount stays at the baseline),
    // so the trustworthy `data-copilot-running` true→false transition never
    // fires. The surface mounted + a bubble exists, yet the done-signal is
    // genuinely MISSING. Because the DOM signal is available, the early
    // backstop fires at `maxTurnDurationMs` (well before the hard ceiling),
    // classified `done-signal-missing`. This is the DOM-present counterpart to
    // the headless F4-3b case and proves the F5 gate did NOT neuter the early
    // backstop for the path where it is legitimate.
    const stoppedNoStart: CopilotRunningState = {
      attrPresent: true,
      runningNow: false,
      sawRunningTrue: false, // no run ever started this turn → no transition
      runStartCount: 0, // equals baseline → sawStopThisTurn never holds
      lastStoppedAtMs: 0,
    };
    const { page, surfaceReady } = makeSurfaceRunSignalPage({
      sse: [0], // never catches up (and is not consulted on the DOM path)
      running: [stoppedNoStart],
      cascade: [{ count: 1, text: null }],
      surface: [true], // surface mounted the whole time
    });
    await expect(
      waitForTurnComplete({
        page,
        turnIndex: 1,
        settleMs: 15,
        timeoutMs: 5_000,
        maxTurnDurationMs: 60, // backstop fires well before the hard ceiling
        baselineCount: 0,
        baselineRunStartCount: 0,
        pollIntervalMs: 5,
        surfaceReady,
      }),
    ).rejects.toMatchObject({
      name: "TurnNotCompleteError",
      reason: "done-signal-missing",
    });
  });

  // ==========================================================================
  // F5 — HEADLESS EARLY-BACKSTOP GATE + systematic backstop/completion matrix
  // ==========================================================================
  //
  // F5 false-red: a HEADLESS turn (attrPresent=false, runningNow=null) whose
  // bubble paints + text settles by `maxTurnDurationMs` but whose ONLY signal
  // — the fragile SSE fetch-counter — lags, catching up only AFTER
  // `maxTurnDurationMs` (≈0.6×timeoutMs) yet BEFORE the hard `timeoutMs`. On
  // the OLD (ungated) backstop this false-RED at `maxTurnDurationMs` as
  // `done-signal-missing`. The fix gates the early backstop on
  // `attrPresent === true`, so the headless turn uses the FULL `timeoutMs` for
  // its only signal and completes GREEN when the counter catches up.
  //
  // The matrix below covers, for BOTH the DOM path (attrPresent=true) and the
  // HEADLESS path (attrPresent=false):
  //   completes-normally          → GREEN
  //   lagging-but-recovers        → GREEN (done-signal/SSE confirms after
  //                                  maxTurnDurationMs but before timeoutMs;
  //                                  NOT early-redded) — the F5 case headless
  //   genuine-hang                → RED with the correct reason
  //                                  (done-signal-missing for DOM at the early
  //                                  backstop; sse-missing for headless at the
  //                                  hard timeout)
  // crossed with the third conjunct being text-stability (default) vs
  // surface-mount (completeOnMount) where applicable. Reuses the existing
  // `makeRunSignalPage` / `makeSurfaceRunSignalPage` page-fakes.

  // -- F5 PRIMARY: the headless lagging-but-recovers false-red kill ----------

  it("(F5) HEADLESS LAGGING-BUT-RECOVERS (text path): SSE counter catches up AFTER maxTurnDurationMs but BEFORE timeoutMs → completes GREEN, NOT early-redded", async () => {
    // The exact F5 false-red. pollIntervalMs=20, maxTurnDurationMs=100 (≈5
    // polls), timeoutMs=2000. A painted + settled headless bubble whose SSE
    // counter stays 0 well past maxTurnDurationMs (polls 0..7) then flips to 1
    // at poll 8 (~160ms elapsed > 100ms maxTurnDurationMs, << 2000ms timeout).
    // On the OLD ungated backstop this RED at ~100ms as done-signal-missing
    // (domOk + textOk held, !doneSignalOk, runningNow=null!==true,
    // stopStableSince=null). The F5 gate (attrPresent===true) keeps the early
    // backstop OFF for headless, so the turn waits and completes GREEN.
    const page = makeRunSignalPage({
      sse: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1], // catches up at poll 8
      running: [runningAbsent], // headless: attribute absent → runningNow null
      cascade: [{ count: 1, text: "lagging headless reply" }], // settled tail
    });
    const result = await waitForTurnComplete({
      page,
      turnIndex: 1,
      settleMs: 30,
      timeoutMs: 2_000,
      maxTurnDurationMs: 100, // early backstop window the lag crosses
      baselineCount: 0,
      pollIntervalMs: 20,
    });
    expect(result.text).toBe("lagging headless reply");
  });

  it("(F5-surface) HEADLESS LAGGING-BUT-RECOVERS (surface-mount path): surface mounted + SSE catches up after maxTurnDurationMs but before timeoutMs → completes GREEN", async () => {
    // The surface-mount (completeOnMount) headless variant of F5: a text-empty
    // A2UI-shape headless turn whose render surface mounts immediately but
    // whose SSE counter lags past maxTurnDurationMs. Must complete GREEN once
    // the counter catches up, not red early.
    const { page, surfaceReady } = makeSurfaceRunSignalPage({
      sse: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1], // catches up at poll 8
      running: [runningAbsent], // headless
      cascade: [{ count: 1, text: null }], // text-empty A2UI shape
      surface: [true], // surface mounted the whole time
    });
    const result = await waitForTurnComplete({
      page,
      turnIndex: 1,
      settleMs: 30,
      timeoutMs: 2_000,
      maxTurnDurationMs: 100,
      baselineCount: 0,
      pollIntervalMs: 20,
      surfaceReady,
    });
    expect(result.bubbleIndex).toBe(0);
  });

  // -- MATRIX: DOM path (attrPresent=true) -----------------------------------

  it("(matrix DOM/text/completes) done-signal confirms promptly → GREEN", async () => {
    // DOM signal present, run goes true→false and STAYS stopped, text settles
    // → completes well before maxTurnDurationMs.
    const page = makeRunSignalPage({
      sse: [0], // SSE never consulted on the DOM path
      running: [runningStarted, runningStopped],
      cascade: [
        { count: 1, text: "dom reply" },
        { count: 1, text: "dom reply" },
      ],
    });
    const result = await waitForTurnComplete({
      page,
      turnIndex: 1,
      settleMs: 30,
      timeoutMs: 2_000,
      maxTurnDurationMs: 1_500,
      baselineCount: 0,
      baselineRunStartCount: 0,
    });
    expect(result.text).toBe("dom reply");
  });

  it("(matrix DOM/text/lagging-recovers) stop edge arrives AFTER maxTurnDurationMs but BEFORE timeoutMs → GREEN (arming guard defers the backstop)", async () => {
    // DOM signal present; the run stays RUNNING past maxTurnDurationMs then
    // stops + stays stopped before the hard timeout. The early backstop must
    // NOT red while running (runningNow guard) nor on the first stopped poll
    // (arming guard) — the turn completes GREEN once quiescence holds.
    const page = makeRunSignalPage({
      // runningNow=true for polls 0..6 (past maxTurnDurationMs=100 @ 20ms),
      // then stops at poll 7 and stays stopped.
      sse: [0],
      running: [
        runningStarted,
        runningStarted,
        runningStarted,
        runningStarted,
        runningStarted,
        runningStarted,
        runningStarted,
        runningStopped,
      ],
      cascade: [{ count: 1, text: "dom lagging reply" }],
    });
    const result = await waitForTurnComplete({
      page,
      turnIndex: 1,
      settleMs: 30,
      timeoutMs: 2_000,
      maxTurnDurationMs: 100,
      baselineCount: 0,
      baselineRunStartCount: 0,
      pollIntervalMs: 20,
    });
    expect(result.text).toBe("dom lagging reply");
  });

  it("(matrix DOM/text/genuine-hang) bubble painted + text settled, run STOPPED but never started for this turn (no transition) → done-signal-missing EARLY at the backstop", async () => {
    // DOM signal present (attrPresent=true) but no run ever started this turn
    // (runStartCount stays at baseline, sawRunningTrue=false), so the
    // true→false transition never fires. domOk + textOk hold, runningNow=false
    // (not true), stopStableSince stays null (sawStopThisTurn false). The early
    // backstop fires at maxTurnDurationMs → done-signal-missing.
    const stoppedNoStart: CopilotRunningState = {
      attrPresent: true,
      runningNow: false,
      sawRunningTrue: false,
      runStartCount: 0,
      lastStoppedAtMs: 0,
    };
    const page = makeRunSignalPage({
      sse: [0],
      running: [stoppedNoStart],
      cascade: [{ count: 1, text: "dom stuck reply" }],
    });
    await expect(
      waitForTurnComplete({
        page,
        turnIndex: 1,
        settleMs: 30,
        timeoutMs: 5_000,
        maxTurnDurationMs: 100, // early backstop fires well before the ceiling
        baselineCount: 0,
        baselineRunStartCount: 0,
        pollIntervalMs: 20,
      }),
    ).rejects.toMatchObject({
      name: "TurnNotCompleteError",
      reason: "done-signal-missing",
    });
  });

  it("(matrix DOM/surface/genuine-hang) surface mounted + no transition → done-signal-missing EARLY at the backstop", async () => {
    // Surface-mount third-conjunct counterpart of the DOM genuine-hang: covered
    // structurally by F4-3c above; this asserts the same outcome through the
    // surface page-fake to keep the {surface}×{DOM}×{genuine-hang} cell
    // explicitly present in the matrix.
    const stoppedNoStart: CopilotRunningState = {
      attrPresent: true,
      runningNow: false,
      sawRunningTrue: false,
      runStartCount: 0,
      lastStoppedAtMs: 0,
    };
    const { page, surfaceReady } = makeSurfaceRunSignalPage({
      sse: [0],
      running: [stoppedNoStart],
      cascade: [{ count: 1, text: null }],
      surface: [true],
    });
    await expect(
      waitForTurnComplete({
        page,
        turnIndex: 1,
        settleMs: 15,
        timeoutMs: 5_000,
        maxTurnDurationMs: 60,
        baselineCount: 0,
        baselineRunStartCount: 0,
        pollIntervalMs: 5,
        surfaceReady,
      }),
    ).rejects.toMatchObject({
      name: "TurnNotCompleteError",
      reason: "done-signal-missing",
    });
  });

  // -- MATRIX: HEADLESS path (attrPresent=false) -----------------------------

  it("(matrix headless/text/completes) SSE counter confirms promptly → GREEN", async () => {
    // Headless completes-normally: SSE catches up well before
    // maxTurnDurationMs. (Mirrors test (3) with explicit matrix framing.)
    const page = makeRunSignalPage({
      sse: [0, 1, 1], // catches up at poll 1
      running: [runningAbsent],
      cascade: [{ count: 1, text: "headless prompt reply" }],
    });
    const result = await waitForTurnComplete({
      page,
      turnIndex: 1,
      settleMs: 30,
      timeoutMs: 2_000,
      maxTurnDurationMs: 1_500,
      baselineCount: 0,
    });
    expect(result.text).toBe("headless prompt reply");
  });

  // headless/text/lagging-recovers === (F5) above.
  // headless/surface/lagging-recovers === (F5-surface) above.

  it("(matrix headless/text/genuine-hang) SSE counter NEVER catches up → sse-missing at the HARD timeout (NOT early)", async () => {
    // Headless genuine-hang on the text path: the early backstop is gated OFF
    // for headless, so the turn runs to the hard timeout and reds sse-missing.
    // (Mirrors (3-red) with explicit matrix framing; small timeout for speed.)
    const page = makeRunSignalPage({
      sse: [0], // never catches up
      running: [runningAbsent],
      cascade: [{ count: 1, text: "headless stuck" }],
    });
    await expect(
      waitForTurnComplete({
        page,
        turnIndex: 1,
        settleMs: 30,
        timeoutMs: 300, // hard ceiling reached fast
        maxTurnDurationMs: 100, // would have fired here on the old backstop
        baselineCount: 0,
      }),
    ).rejects.toMatchObject({
      name: "TurnNotCompleteError",
      reason: "sse-missing",
    });
  });

  it("(matrix headless/surface/genuine-hang) surface mounted + SSE NEVER catches up → sse-missing at the HARD timeout (NOT early)", async () => {
    // Headless genuine-hang on the surface-mount path. (Mirrors (F4-3b) with
    // explicit matrix framing.)
    const { page, surfaceReady } = makeSurfaceRunSignalPage({
      sse: [0],
      running: [runningAbsent],
      cascade: [{ count: 1, text: null }],
      surface: [true],
    });
    await expect(
      waitForTurnComplete({
        page,
        turnIndex: 1,
        settleMs: 15,
        timeoutMs: 200,
        maxTurnDurationMs: 60,
        baselineCount: 0,
        baselineRunStartCount: 0,
        pollIntervalMs: 5,
        surfaceReady,
      }),
    ).rejects.toMatchObject({
      name: "TurnNotCompleteError",
      reason: "sse-missing",
    });
  });
});
