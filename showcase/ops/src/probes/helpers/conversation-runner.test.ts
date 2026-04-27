import { describe, it, expect } from "vitest";
import { runConversation } from "./conversation-runner.js";
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
}

function makePage(script: PageScript = {}): Page {
  const queue = [...(script.evaluateValues ?? [])];
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
      // Drain one value per call. Once exhausted, freeze on the last
      // value so any post-script poll sees the steady-state count
      // (matches a real assistant message that has finished streaming).
      if (queue.length === 0) return 0 as never;
      if (queue.length === 1) return queue[0]! as never;
      return queue.shift()! as never;
    },
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
      async evaluate() {
        // First read is the baseline (= 0); subsequent reads return 1
        // and stay there → growth past baseline + stable → settled.
        evalCalls++;
        return (evalCalls === 1 ? 0 : 1) as never;
      },
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
      async evaluate() {
        evalCalls++;
        return (evalCalls === 1 ? 0 : 1) as never;
      },
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
      async evaluate() {
        evalCalls++;
        return (evalCalls === 1 ? 0 : 1) as never;
      },
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
    let calls = 0;
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate() {
        calls++;
        if (calls === 1) throw new Error("evaluate boom");
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

    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate(fn) {
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

    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate(fn) {
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
