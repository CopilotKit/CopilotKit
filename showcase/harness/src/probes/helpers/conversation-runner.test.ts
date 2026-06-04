import { describe, it, expect } from "vitest";
import {
  runConversation,
  fillAndVerifySend,
  readUserMessageCount,
  waitForContentAndSend,
  AssistantErroredError,
} from "./conversation-runner.js";
import type { ConversationTurn, Page } from "./conversation-runner.js";

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
  evaluate?: (fn: () => unknown) => Promise<unknown>;
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
  return (async <R>(fn: () => R): Promise<R> => {
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
    return inner(fn) as Promise<R>;
  }) as Page["evaluate"];
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

function makePage(script: PageScript = {}): Page {
  const queue = [...(script.evaluateValues ?? [])];
  const userQueue = [...(script.userMessageValues ?? [])];
  const inputQueue = [...(script.inputValues ?? [])];
  const errorBannerQueue = [...(script.errorBannerValues ?? [])];
  // Auto-succeed counter: first user-message read = 0 (baseline),
  // subsequent reads = 1 (growth detected → verify loop succeeds).
  let autoUserCalls = 0;
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
    async evaluate(fn) {
      if (script.evaluate) return script.evaluate(fn) as never;

      // Detect whether the evaluate call is reading user messages or
      // assistant messages by inspecting the function body. The
      // readUserMessageCount function references "copilot-user-message"
      // while readMessageCount references "copilot-assistant-message".
      const fnBody = fn.toString();
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

      // Drain one value per call. Once exhausted, freeze on the last
      // value so any post-script poll sees the steady-state count
      // (matches a real assistant message that has finished streaming).
      if (queue.length === 0) return 0 as never;
      if (queue.length === 1) return queue[0]! as never;
      return queue.shift()! as never;
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
  };
}

describe("runConversation", () => {
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
    expect(result.error!.toLowerCase()).toContain("timeout");
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
    // The whole point: bail well before the 5000ms responseTimeout.
    expect(elapsed).toBeLessThan(2000);
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
    // Bailed well before the 5000ms responseTimeout — the whole point.
    expect(elapsed).toBeLessThan(2000);
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
      // flicker is evaluated while `current <= baselineCount` — exercising the
      // real debounce-reset path, NOT the success-in-flight disarm. THEN it
      // grows to 1 and freezes so the turn settles AFTER the flicker poll has
      // been seen. Evaluate draws (a `readMessageCount` per read): #1=boot
      // baseline (conversation-runner.ts:362), #2=waitForAssistantSettled
      // initial lastCount, #3=loop poll1, #4=loop poll2 (the flicker poll —
      // still 0, so debounce path runs), #5=loop poll3 (1), then frozen at 1
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
    // Debounce adds ~1 poll of latency at most — still far under the 5000ms
    // responseTimeout.
    expect(elapsed).toBeLessThan(2000);
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
      // fresh-banner flicker is evaluated while `current <= baselineCount` —
      // exercising the real debounce-reset path, NOT the success-in-flight
      // disarm. THEN it grows to 1 and freezes → settles AFTER the flicker
      // poll is reached. Draws (a `readMessageCount` per read): #1=boot
      // baseline (conversation-runner.ts:362), #2=waitForAssistantSettled
      // initial lastCount, #3=loop poll1, #4=loop poll2 (the flicker poll —
      // still 0, so debounce path runs), #5=loop poll3 (1), frozen 1 → count
      // change resets lastChangeAt, settle fires after settleMs.
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
    // Bailed well before the 5000ms responseTimeout — the whole point.
    expect(elapsed).toBeLessThan(2000);
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
    // on subsequent reads. The runner's readMessageCount catch returns 0
    // on error so the baseline becomes 0 and the turn still settles when
    // the count grows.
    let assistantCalls = 0;
    let userCalls = 0;
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate(fn) {
        // User-message reads return a monotonically increasing count
        // so fillAndVerifySend sees growth and doesn't retry.
        if (fn.toString().includes("copilot-user-message")) {
          return userCalls++ as never;
        }
        // Error-banner visibility probe: return the runner-expected
        // `{ visible: false }` shape (mirrors `wrapEvaluateForUserMessages`).
        // Without this branch the read fell through to the assistant-count
        // path and returned a NUMBER — the no-banner path only "passed" by
        // the accident that `(number).visible` is `undefined` (falsy).
        if (fn.toString().includes("copilot-error-banner")) {
          return { visible: false } as never;
        }
        assistantCalls++;
        if (assistantCalls === 1) throw new Error("evaluate boom");
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
    const fakeDocument = {
      querySelectorAll: (sel: string): { length: number } => {
        queriedSelectors.push(sel);
        // Canonical testid: 0 (forces fallback path).
        if (sel === '[data-testid="copilot-assistant-message"]') {
          return { length: 0 };
        }
        // Tagged-assistant articles: 0 (forces narrowed-article path).
        if (sel === '[role="article"][data-message-role="assistant"]') {
          return { length: 0 };
        }
        // Narrowed-article selector excludes user-tagged articles.
        // First call (baseline) → 0; subsequent calls → 2 (settled).
        if (sel === '[role="article"]:not([data-message-role="user"])') {
          return { length: evalCount === 0 ? 0 : 2 };
        }
        // Headless tier: present in cascade for custom-composer demos
        // (e.g. headless-simple) that don't use [role="article"].
        // Returns 0 here so the narrowed-article tier is the one that
        // actually drives the settle loop.
        if (sel === '[data-message-role="assistant"]') {
          return { length: 0 };
        }
        // ANY other [role="article"] selector means we leaked the
        // unscoped fallback that this fix was supposed to remove.
        return { length: 999 };
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
    const fakeDocument = {
      querySelectorAll: (sel: string): { length: number } => {
        queriedSelectors.push(sel);
        if (sel === '[data-testid="copilot-assistant-message"]') {
          return { length: 0 };
        }
        if (sel === '[role="article"][data-message-role="assistant"]') {
          return { length: evalCount === 0 ? 1 : 2 };
        }
        return { length: 999 };
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
