/**
 * Mechanism-GREEN tests for the Phase-4 probe contract migration.
 *
 * Phase 4 introduces two contract changes the runner + probes must
 * cooperatively obey:
 *
 *   1. `readAssistantTextAt(page, bubbleIndex)` is the turn-scoped
 *      replacement for `readLastAssistantText(page)`. It MUST resolve
 *      the bubble at the strict index supplied — not "the last bubble
 *      currently in the DOM". The "last-bubble" approach is what
 *      motivated defect 2 in the bubble-race fix: a stale prior-turn
 *      bubble leaking into the current turn's assertions.
 *
 *   2. The `turn.assertions(...)` callback receives a SECOND argument
 *      `ctx: { bubbleIndex, text }`. Phase 4 wires a bridge inside
 *      `conversation-runner.ts` that synthesises the ctx from a
 *      post-settle `readMessageCount` + `readAssistantTextAt(...)`
 *      pair (Phase 5 replaces that bridge with the values returned by
 *      `waitForTurnComplete`). This file pins the bridge contract so
 *      Phase 5's swap can't silently drop the ctx parameter.
 *
 * Both tests use scripted structural Page fakes — same idiom as the
 * sibling `wait-for-turn-complete.test.ts` — so each case runs
 * millisecond-cheap and stays deterministic without spinning up a
 * real browser. The scripts dispatch on the function body of the
 * evaluate call so we can route SSE / count / text reads to distinct
 * fixture values, mirroring the real production read shapes.
 */
import { describe, it, expect } from "vitest";
import { runConversation } from "../../src/probes/helpers/conversation-runner.js";
import type {
  ConversationTurn,
  Page,
} from "../../src/probes/helpers/conversation-runner.js";
import { readAssistantTextAt } from "../../src/probes/scripts/_gen-ui-shared.js";

/**
 * Build a Page double that returns a fixed list of assistant bubble
 * textContents under the shared cascade. The cascade dispatch lives
 * inside `findAssistantBubbleAt`'s page.evaluate — which calls
 * `querySelectorAll(tier)` to discover bubble count, then reads
 * `list[idx].textContent` for the requested index. We emulate that
 * shape by branching on the presence of `arg` (the index): no arg =
 * count, arg = textContent-at-index.
 */
function makeBubblePage(bubbleTexts: string[]): Page {
  const evaluate: Page["evaluate"] = (async (
    fn: unknown,
    arg?: unknown,
  ): Promise<unknown> => {
    // findAssistantBubbleAt calls page.evaluate(fn, idx). When no arg is
    // present we're answering a count-shaped probe; with an index we
    // return that bubble's text (or null when out of range — same as
    // the production helper).
    if (arg === undefined) return bubbleTexts.length;
    const idx = arg as number;
    if (idx < 0 || idx >= bubbleTexts.length) return null;
    void fn;
    return bubbleTexts[idx] ?? "";
  }) as Page["evaluate"];
  return {
    async waitForSelector() {
      /* no-op */
    },
    async fill() {
      /* no-op */
    },
    async press() {
      /* no-op */
    },
    evaluate,
  };
}

/**
 * Build a Page double tailored to driving `runConversation` end-to-end
 * with the new assertions-ctx contract.
 *
 * The runner's evaluate calls (in approximate order per turn):
 *   - user-message count probes (`copilot-user-message`)
 *   - error-banner visibility (`copilot-error-banner`)
 *   - assistant-message count probes (the rest)
 *   - after settle, the bridge calls readMessageCount + readAssistantTextAt
 *
 * The script consumes one assistant-count per assistant-count read
 * (queue-style; freezes on the last value when exhausted). The bridge
 * read uses page.evaluate(fn, idx) — branched on arg-presence to
 * return the bubble text fixture.
 */
function makeRunnerPage(opts: {
  assistantCounts: number[];
  bubbleTexts: string[];
}): Page {
  const queue = [...opts.assistantCounts];
  let userCalls = 0;
  // Track the most recent assistant-count value drained from the queue.
  // The post-cutover `waitForTurnComplete` primitive reads BOTH an SSE
  // run-finished counter (`window.__hk_runsFinished`) and the atomic
  // `readCascadeState` `{count, text}` shape per poll. We synthesise
  // the SSE counter from the latest observed count (any time the
  // assistant DOM has grown to N bubbles, the server must have
  // flushed N RUN_FINISHED events) and the cascade-state text from
  // `opts.bubbleTexts[idx]` — mirroring the `wrapEvaluateForUserMessages`
  // helper in `conversation-runner.test.ts`.
  let latestCount = 0;
  const evaluate: Page["evaluate"] = (async (
    fn: unknown,
    arg?: unknown,
  ): Promise<unknown> => {
    const body = String(fn);
    // SSE run-finished counter read (`waitForTurnComplete` conjunct 1).
    // Routed BEFORE the arg-presence text branch because the SSE closure
    // is called with NO runtime arg, and BEFORE the count branch because
    // its body doesn't reference `querySelectorAll`. Synthesised from
    // the latest observed assistant count.
    if (body.includes("__hk_runsFinished")) {
      return latestCount;
    }
    // Atomic cascade-state read (`readCascadeState`): returns BOTH the
    // count and the indexed text from the SAME cascade tier in ONE
    // round-trip. The closure body matches BOTH the legacy text-at-index
    // dispatch heuristics (`querySelectorAll` + `textContent`) AND a
    // runtime arg (the bubbleIndex), so it MUST be routed before the
    // legacy arg-presence text branch. The distinguishing substring is
    // the literal `{ count` the closure uses to construct its return
    // object. Drain the count queue (same as the count-only branch),
    // then synthesise the text from `opts.bubbleTexts[idx]`.
    if (
      body.includes("querySelectorAll") &&
      body.includes("textContent") &&
      body.includes("{ count")
    ) {
      // Drain the count progression as a count-shaped read so a script
      // like [0, 0, 1, 1, ...] advances through the same plateau values
      // it would for a stand-alone `countAssistantMessages` call.
      let nextCount: number;
      if (queue.length === 0) nextCount = 0;
      else if (queue.length === 1) nextCount = queue[0]!;
      else nextCount = queue.shift()!;
      latestCount = nextCount;
      const idx = (arg as number | undefined) ?? 0;
      const text =
        idx < 0 || idx >= nextCount ? null : (opts.bubbleTexts[idx] ?? "");
      return { count: nextCount, text };
    }
    // Text-at-index branch (findAssistantBubbleAt).
    if (arg !== undefined) {
      const idx = arg as number;
      if (idx < 0 || idx >= opts.bubbleTexts.length) return null;
      return opts.bubbleTexts[idx] ?? "";
    }
    if (body.includes("copilot-error-banner")) {
      return { visible: false };
    }
    if (body.includes("copilot-user-message")) {
      // Auto-succeeding monotonic counter so fillAndVerifySend sees
      // growth and never blocks the test on the user-bubble settle.
      return userCalls++;
    }
    // The runner's post-settle diagnostic log calls `querySelector(...)?.textContent`
    // to capture the settled text for trace purposes — distinct from the
    // count/text-at-index probes above. Detect the single-selector
    // textContent shape and return the first bubble's text so the
    // `.slice(0, 200)` log call has a string to operate on.
    if (body.includes("textContent") && !body.includes("querySelectorAll")) {
      return opts.bubbleTexts[0] ?? "";
    }
    // Assistant-message count probe (default).
    let nextCount: number;
    if (queue.length === 0) nextCount = 0;
    else if (queue.length === 1) nextCount = queue[0]!;
    else nextCount = queue.shift()!;
    latestCount = nextCount;
    return nextCount;
  }) as Page["evaluate"];
  return {
    async waitForSelector() {
      /* no-op */
    },
    async fill() {
      /* no-op */
    },
    async press() {
      /* no-op */
    },
    evaluate,
  };
}

describe("readAssistantTextAt (mechanism-GREEN)", () => {
  it("returns the text of the bubble at the requested INDEX — not the last bubble globally", async () => {
    // Three bubbles in the DOM. Asking for index 1 must return the
    // MIDDLE bubble's text, not the last one. This is the exact race
    // defect 2 motivates: the prior `readLastAssistantText` would
    // return `list[list.length - 1]`, leaking a later bubble's content
    // into the assertions for an earlier turn.
    const page = makeBubblePage([
      "first bubble text",
      "second bubble text",
      "third bubble text",
    ]);
    const text = await readAssistantTextAt(page as never, 1);
    expect(text).toBe("second bubble text");
  });

  it("returns empty string when the requested index is out of range", async () => {
    // Out-of-range index is a "turn not yet complete" signal, NOT a
    // hard error. The helper coerces null to "" so callers can keep
    // polling without a try/catch.
    const page = makeBubblePage(["only bubble"]);
    const text = await readAssistantTextAt(page as never, 5);
    expect(text).toBe("");
  });
});

describe("assertions(page, ctx) bridge (mechanism-GREEN)", () => {
  it("invokes the turn's assertions callback with a ctx carrying bubbleIndex:number + text:string", async () => {
    // Drive a single-turn conversation with scripted assistant counts
    // (0 → 1 → 1 ...) so the settle loop sees one bubble appear and
    // stabilise. The bridge in conversation-runner then reads the
    // bubble's text and supplies it as ctx.text to assertions.
    const recordedCtx: Array<{
      bubbleIndex: number;
      text: string;
      bubbleIndexType: string;
      textType: string;
    }> = [];
    const turns: ConversationTurn[] = [
      {
        input: "hello",
        // The new signature: a second `ctx` param. TypeScript only
        // requires it to match the production callback signature
        // post-Phase 4; until then we use a permissive shape so this
        // file compiles regardless of whether ConversationTurn's
        // assertions field has been widened yet. The runtime check
        // verifies the bridge actually passes the values.
        assertions: (async (_page: Page, ctx: unknown) => {
          const c = ctx as { bubbleIndex: number; text: string };
          recordedCtx.push({
            bubbleIndex: c.bubbleIndex,
            text: c.text,
            bubbleIndexType: typeof c.bubbleIndex,
            textType: typeof c.text,
          });
        }) as ConversationTurn["assertions"],
      },
    ];

    // 0 baseline, then 1 (a single assistant bubble appears and stays).
    const page = makeRunnerPage({
      assistantCounts: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      bubbleTexts: ["assistant reply text"],
    });

    const result = await runConversation(page, turns, {
      assistantSettleMs: 50,
    });

    expect(result.failure_turn).toBeUndefined();
    expect(result.turns_completed).toBe(1);
    expect(recordedCtx).toHaveLength(1);
    expect(recordedCtx[0]!.bubbleIndexType).toBe("number");
    expect(recordedCtx[0]!.textType).toBe("string");
    expect(recordedCtx[0]!.bubbleIndex).toBe(0);
    expect(recordedCtx[0]!.text).toBe("assistant reply text");
  }, 20_000);

  it("supplies turn-scoped ctx across a multi-turn conversation — each turn's ctx carries its OWN bubbleIndex and bubble text (not a prior turn's)", async () => {
    // Defect 2's whole point: turn N's assertions must receive a ctx
    // pointing at turn N's bubble — NOT a stale prior-turn bubble that
    // happens to be "last in the DOM". A single-turn test cannot
    // distinguish "bridge correctly passes ctx" from "bridge accidentally
    // hands every turn turn-1's ctx" — both look identical when there's
    // only one turn. This multi-turn fixture forces the bridge to
    // advance bubbleIndex per turn AND to read each turn's distinct
    // text, locking the turn-scoped contract.
    const recordedCtx: Array<{ bubbleIndex: number; text: string }> = [];
    const bubbleTexts = [
      "turn-1 assistant reply",
      "turn-2 assistant reply",
      "turn-3 assistant reply",
    ];
    const turns: ConversationTurn[] = bubbleTexts.map((_, i) => ({
      input: `user message ${i + 1}`,
      assertions: (async (_page: Page, ctx: unknown) => {
        const c = ctx as { bubbleIndex: number; text: string };
        recordedCtx.push({ bubbleIndex: c.bubbleIndex, text: c.text });
      }) as ConversationTurn["assertions"],
    }));

    // Assistant-count script: baseline 0; then settles to 1, 2, 3 as
    // each turn's bubble appears. The queue freezes on its last value
    // once exhausted (makeRunnerPage semantics), so the settle loop
    // sees stable counts within each turn. We pad each plateau with
    // enough samples to clear assistantSettleMs at 50ms tick.
    const page = makeRunnerPage({
      assistantCounts: [
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3,
        3, 3, 3, 3, 3, 3, 3, 3,
      ],
      bubbleTexts,
    });

    const result = await runConversation(page, turns, {
      assistantSettleMs: 50,
    });

    expect(result.failure_turn).toBeUndefined();
    expect(result.turns_completed).toBe(3);
    expect(recordedCtx).toHaveLength(3);
    // Each turn's ctx must point at its OWN 0-indexed bubble position
    // AND that bubble's text. A bug that hands every turn ctx from a
    // single (e.g. the first or the last) bubble would fail one of
    // these per-turn assertions.
    for (let i = 0; i < 3; i++) {
      expect(recordedCtx[i]!.bubbleIndex).toBe(i);
      expect(recordedCtx[i]!.text).toBe(bubbleTexts[i]);
    }
  }, 30_000);
});
