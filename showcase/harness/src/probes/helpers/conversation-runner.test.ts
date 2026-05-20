import { describe, it, expect } from "vitest";
import {
  runConversation,
  fillAndVerifySend,
  readUserMessageCount,
  waitForContentAndSend,
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
 * small value (50 ms) and use vitest's fake timers where the runner's
 * polling loop would otherwise dominate wall time.
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
    if (fn.toString().includes("copilot-user-message")) {
      return userCalls++ as never;
    }
    return inner(fn) as Promise<R>;
  }) as Page["evaluate"];
}

function makePage(script: PageScript = {}): Page {
  const queue = [...(script.evaluateValues ?? [])];
  const userQueue = [...(script.userMessageValues ?? [])];
  const inputQueue = [...(script.inputValues ?? [])];
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
  });

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
  });

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

  it("empty turns array: returns zeroes immediately", async () => {
    const page = makePage();
    const result = await runConversation(page, []);

    expect(result.turns_completed).toBe(0);
    expect(result.total_turns).toBe(0);
    expect(result.failure_turn).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.turn_durations_ms).toEqual([]);
  });

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
        const originalDoc = (globalThis as { document?: unknown }).document;
        (globalThis as { document?: unknown }).document = fakeDocument;
        try {
          const r = fn();
          evalCount++;
          return r as never;
        } finally {
          (globalThis as { document?: unknown }).document = originalDoc;
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
        const originalDoc = (globalThis as { document?: unknown }).document;
        (globalThis as { document?: unknown }).document = fakeDocument;
        try {
          const r = fn();
          evalCount++;
          return r as never;
        } finally {
          (globalThis as { document?: unknown }).document = originalDoc;
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
  });

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
