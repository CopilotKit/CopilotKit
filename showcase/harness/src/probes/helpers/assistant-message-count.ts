import type { Page } from "playwright";

/**
 * Single source of truth for the assistant-bubble DOM cascade used
 * by both the conversation runner AND the d5/d6 diagnostics paths.
 *
 * Cascade lives in assistant-message-count.ts (single source of truth).
 * Sibling readers (_hitl-shared, _gen-ui-shared, d5-agentic-chat,
 * d5-shared-state) import these constants directly; conversation-runner
 * re-exports them for back-compat with any older import paths.
 *
 * The cascade tiers (in order):
 *   1. Canonical: [data-testid="copilot-assistant-message"]
 *   2. Tagged article: [role="article"][data-message-role="assistant"]
 *   3. Non-user article: [role="article"]:not([data-message-role="user"])
 *   4. Headless: [data-message-role="assistant"]
 *
 * Each helper picks the FIRST tier whose match-count is > 0 and
 * uses that tier exclusively. This mirrors readMessageCount's prior
 * behaviour (conversation-runner.ts:936-:980 at plan-author time).
 *
 * Note: the 3-constant re-exports (PRIMARY/FALLBACK/HEADLESS) reflect a
 * historical 3-tier read used by the sibling scripts that predates the
 * 4-tier `[role="article"][data-message-role="assistant"]` insertion
 * for the canonical cascade. The constants are intentionally limited to
 * tiers 1, 3, 4 to preserve those scripts' established cascade order —
 * tier 2 is reachable inside `countAssistantMessages`/`findAssistantBubbleAt`
 * via the inlined cascade body below.
 *
 * The DOM types are reached via a type-erased indirection because the
 * package's tsconfig intentionally excludes the `dom` lib (server-side
 * Node code). Same pattern used in `_gen-ui-shared.ts:154-186` and
 * `conversation-runner.ts:readMessageCount`.
 */

/** Canonical CopilotKit assistant-message testid (cascade tier 1). */
export const ASSISTANT_MESSAGE_PRIMARY_SELECTOR =
  '[data-testid="copilot-assistant-message"]';
/** ARIA article fallback excluding explicit user bubbles (cascade tier 3). */
export const ASSISTANT_MESSAGE_FALLBACK_SELECTOR =
  '[role="article"]:not([data-message-role="user"])';
/** Headless/custom-composer last-resort (cascade tier 4). */
export const ASSISTANT_MESSAGE_HEADLESS_SELECTOR =
  '[data-message-role="assistant"]';

export async function countAssistantMessages(page: Page): Promise<number> {
  try {
    return await page.evaluate(() => {
      const win = globalThis as unknown as {
        document: { querySelectorAll(sel: string): { length: number } };
      };
      const tiers = [
        '[data-testid="copilot-assistant-message"]',
        '[role="article"][data-message-role="assistant"]',
        '[role="article"]:not([data-message-role="user"])',
        '[data-message-role="assistant"]',
      ];
      for (const sel of tiers) {
        const n = win.document.querySelectorAll(sel).length;
        if (n > 0) return n;
      }
      return 0;
    });
  } catch (err) {
    console.warn(
      `[assistant-message-count] countAssistantMessages: ${(err as Error).message ?? err}`,
    );
    return 0;
  }
}

/**
 * Resolve the assistant bubble at strict index `bubbleIndex` (0-based)
 * via the same cascade as countAssistantMessages. Returns the bubble's
 * MESSAGE-TEXT textContent (scoped to the bubble's inner message-content
 * region — NOT the whole bubble wrapper) or null when the index is out
 * of range.
 *
 * Why scoped, not whole-bubble: LGP-canonical chat (and other v2 demos
 * that opt into suggestion-pills via `useConfigureSuggestions`) inject
 * trailing suggestion-pill DOM into the assistant bubble's surrounding
 * area AFTER the streamed message text has landed. The canonical
 * assistant bubble (`[data-testid="copilot-assistant-message"]`) also
 * carries a toolbar (`[data-testid="copilot-assistant-toolbar"]`) as a
 * sibling of the markdown wrapper — its icon/aria text content shifts
 * once the toolbar mounts post-stream. Reading the whole bubble's
 * `textContent` therefore conflates "message text" with "post-message
 * UI affordances", and the text-stable conjunct in `waitForTurnComplete`
 * will see the textContent shift forever (defect-1 + defect-4 RED with
 * `reason=text-unstable`). Scoping the read to the markdown-content
 * child element decouples the conjunct from the UI affordances that
 * canonically arrive AFTER the message.
 *
 * Per-tier message-text selectors (each scoped INSIDE the bubble found
 * at `idx` in the matched cascade tier):
 *   - canonical `[data-testid="copilot-assistant-message"]`:
 *       first `.cpk\:prose` child (the Streamdown wrapper in
 *       `CopilotChatAssistantMessage.tsx` — its sibling is the toolbar +
 *       any tool-calls view).
 *   - `[role="article"]` + `[data-message-role="assistant"]` tiers
 *     (e.g. langgraph-python:headless-simple via
 *     `showcase/integrations/STAR/headless-simple/message-bubble.tsx`):
 *       first paragraph child of the bubble — these custom bubbles wrap
 *       the streamed content in a single paragraph element.
 *
 * If no scoped match is found within a matched bubble (or every scoped
 * match is empty/whitespace-only mid-stream), we DO NOT fall back to the
 * bubble's full `textContent` — returning the whole bubble would re-introduce
 * the LGP-pill / toolbar pollution this cascade was added to prevent
 * (see the per-tier scoping rationale above). Instead we return `null` so
 * the settle gate's `text !== null && text.trim().length > 0` guard keeps
 * polling until a scoped child populates.
 *
 * The bubble is resolved from whichever tier matched in the same call,
 * so a runner that observed `count=N` at tier-T can ask for any
 * `bubbleIndex < N` and trust they share a tier.
 *
 * Implementation note: the body still references `querySelectorAll`
 * AND `textContent` as anchor strings — the unit-test fake in
 * `conversation-runner.test.ts` + `probe-contract.test.ts` dispatches
 * on those substrings to route the evaluate call to the text-at-index
 * branch (see `conversation-runner.test.ts:228`).
 */
export async function findAssistantBubbleAt(
  page: Page,
  bubbleIndex: number,
): Promise<string | null> {
  try {
    return await page.evaluate((idx: number) => {
      // Per-tier (bubble-selector, scoped-text-selectors). The scoped
      // selectors are queried via `bubble.querySelector` once we've
      // resolved the bubble at `idx`. We use `document.querySelectorAll`
      // directly (Playwright runs this in the browser context where the
      // global `document` is the DOM document) — no type-erased globalThis
      // indirection, which has caused undefined-item bugs in the past.
      // The DOM lib is intentionally excluded from this package's tsconfig
      // (this file runs in Node-land code-gen, but the closure is shipped
      // to the browser via page.evaluate). Re-establish the shape locally.
      interface DomElement {
        readonly textContent: string | null;
        querySelector(sel: string): DomElement | null;
      }
      interface DomNodeList {
        readonly length: number;
        item(idx: number): DomElement | null;
      }
      const doc = (
        globalThis as unknown as {
          document: { querySelectorAll(sel: string): DomNodeList };
        }
      ).document;
      const tiers: Array<{ bubble: string; textSelectors: string[] }> = [
        {
          bubble: '[data-testid="copilot-assistant-message"]',
          textSelectors: ["[data-message-content]", ".cpk\\:prose", ".prose"],
        },
        {
          bubble: '[role="article"][data-message-role="assistant"]',
          textSelectors: ["[data-message-content]", "p"],
        },
        {
          bubble: '[role="article"]:not([data-message-role="user"])',
          textSelectors: ["[data-message-content]", "p"],
        },
        {
          bubble: '[data-message-role="assistant"]',
          textSelectors: ["[data-message-content]", "p"],
        },
      ];
      for (const tier of tiers) {
        const list = doc.querySelectorAll(tier.bubble);
        if (list.length > 0) {
          if (idx < 0 || idx >= list.length) return null;
          const bubble = list.item(idx);
          if (!bubble) return null;
          // Fall through to the next scoped selector when the matched
          // element exists but has empty/whitespace-only textContent —
          // some bubble shapes mount `[data-message-content]` as a
          // static-empty wrapper before children populate (or the real
          // text lives in a sibling `.cpk\:prose` / `p`). Returning ""
          // here would lock the settle gate on `text-unstable` until
          // timeout. See `resolveBubbleTextFromSelectors` (sibling
          // pure helper) — kept in lock-step with the closure body so
          // unit tests can exercise the cascade without JSDOM.
          for (const textSel of tier.textSelectors) {
            const scoped = bubble.querySelector(textSel);
            if (scoped !== null) {
              const t = scoped.textContent ?? "";
              if (t.trim().length > 0) {
                return t;
              }
            }
          }
          // Cascade-pollution guard: ALL per-tier scoped selectors are
          // present-but-empty (a transient mid-stream state). DO NOT fall
          // through to `bubble.textContent` — the whole bubble conflates
          // message text with post-message UI affordances (LGP suggestion
          // pills, the canonical assistant toolbar) and re-introduces the
          // exact pollution this scoped cascade exists to prevent.
          // Return null so the runner's `text !== null && text.trim().length > 0`
          // settle gate keeps polling rather than locking onto polluted text.
          return null;
        }
      }
      return null;
    }, bubbleIndex);
  } catch (err) {
    console.warn(
      `[assistant-message-count] findAssistantBubbleAt: ${(err as Error).message ?? err}`,
    );
    return null;
  }
}

/**
 * Atomic single-`page.evaluate` reader returning BOTH the assistant-bubble
 * count and the text at `bubbleIndex` from the SAME cascade tier in ONE
 * browser-side round-trip.
 *
 * Why: callers that need both (e.g. `waitForTurnComplete`) used to call
 * `countAssistantMessages` then `findAssistantBubbleAt` in two sequential
 * `page.evaluate` calls. Between the two round-trips the DOM can mutate —
 * the count read may resolve to tier 2 (4 bubbles), then a tier-1 bubble
 * mounts and the subsequent text read resolves to tier 1 (now 5 bubbles).
 * The two reads' "bubble at index N" would refer to DIFFERENT DOM nodes
 * across tiers. This atomic helper picks ONE tier inside the closure and
 * returns the count + indexed text from that SAME tier, eliminating the
 * cross-tier race.
 *
 * Contract:
 *   - count: from whichever tier matched (the first tier whose `length > 0`)
 *   - text:  per-tier scoped text at `bubbleIndex` within that SAME tier,
 *            using the same scoped-text cascade as `findAssistantBubbleAt`
 *            (returns null when no scoped child has non-empty text, NOT
 *            the whole-bubble textContent — see that function for why).
 *   - When no tier matches at all: `{ count: 0, text: null }`.
 *   - When `bubbleIndex` is out of range within the matched tier:
 *     `{ count: <matched tier count>, text: null }`.
 *
 * The standalone `countAssistantMessages` and `findAssistantBubbleAt`
 * functions remain exported for callers that need only one of the two
 * (e.g. `_gen-ui-shared`, `d6-all-pills`, `countFinal` re-classification).
 *
 * Implementation note: the closure body references `querySelectorAll`
 * AND `textContent` as anchor substrings — the unit-test fakes in
 * `conversation-runner.test.ts` and `assistant-message-count.test.ts`
 * dispatch on those substrings to route the evaluate call.
 */
export async function readCascadeState(
  page: Page,
  bubbleIndex: number,
): Promise<{ count: number; text: string | null }> {
  try {
    return await page.evaluate((idx: number) => {
      interface DomElement {
        readonly textContent: string | null;
        querySelector(sel: string): DomElement | null;
      }
      interface DomNodeList {
        readonly length: number;
        item(idx: number): DomElement | null;
      }
      const doc = (
        globalThis as unknown as {
          document: { querySelectorAll(sel: string): DomNodeList };
        }
      ).document;
      const tiers: Array<{ bubble: string; textSelectors: string[] }> = [
        {
          bubble: '[data-testid="copilot-assistant-message"]',
          textSelectors: ["[data-message-content]", ".cpk\\:prose", ".prose"],
        },
        {
          bubble: '[role="article"][data-message-role="assistant"]',
          textSelectors: ["[data-message-content]", "p"],
        },
        {
          bubble: '[role="article"]:not([data-message-role="user"])',
          textSelectors: ["[data-message-content]", "p"],
        },
        {
          bubble: '[data-message-role="assistant"]',
          textSelectors: ["[data-message-content]", "p"],
        },
      ];
      for (const tier of tiers) {
        const list = doc.querySelectorAll(tier.bubble);
        if (list.length > 0) {
          const count = list.length;
          if (idx < 0 || idx >= count) {
            return { count, text: null };
          }
          const bubble = list.item(idx);
          if (!bubble) return { count, text: null };
          for (const textSel of tier.textSelectors) {
            const scoped = bubble.querySelector(textSel);
            if (scoped !== null) {
              const t = scoped.textContent ?? "";
              if (t.trim().length > 0) {
                return { count, text: t };
              }
            }
          }
          // Cascade-pollution guard mirroring `findAssistantBubbleAt`:
          // no scoped child has non-empty text — return null rather than
          // falling back to the whole bubble's textContent.
          return { count, text: null };
        }
      }
      return { count: 0, text: null };
    }, bubbleIndex);
  } catch (err) {
    console.warn(
      `[assistant-message-count] readCascadeState: ${(err as Error).message ?? err}`,
    );
    return { count: 0, text: null };
  }
}

/**
 * Atomic single-`page.evaluate` reader returning BOTH the assistant-bubble
 * count and the text at the LAST bubble (`count - 1`) in the matched cascade
 * tier — in ONE browser-side round-trip.
 *
 * Why "last" rather than a caller-supplied strict index: multi-step agents
 * (LangGraph, Mastra, CrewAI, …) emit MULTIPLE assistant bubbles per turn
 * (tool-call bubble + tool-render bubble + final-text bubble). Reading the
 * bubble at strict index `turnIndex - 1` would land on an intermediate
 * tool-call bubble whose scoped-text selectors (`[data-message-content]`,
 * `.cpk\:prose`, `.prose`, `p`) are EMPTY — the tool-call's content lives
 * in a sibling node outside the scoped-text cascade — so the cascade-
 * pollution guard returns null forever and the text-stable conjunct times
 * out with `reason=text-unstable`. The LAST bubble in a multi-step turn is
 * the agent's final-text bubble whose `.cpk\:prose` contains the streamed
 * message text, which is the only bubble whose stable text can settle the
 * gate.
 *
 * Defect-2 protection (un-turn-scoped bubble selection) is preserved by the
 * caller: `waitForTurnComplete` snapshots a `baselineCount` BEFORE submit
 * and only treats `count > baselineCount` as "a new bubble for this turn
 * has appeared", so reading the last bubble cannot leak a leftover from a
 * prior turn.
 *
 * Contract — same as `readCascadeState` but with `idx` resolved internally:
 *   - count: from whichever tier matched (first tier whose `length > 0`)
 *   - text:  per-tier scoped text at index `count - 1` within that SAME tier,
 *            using the same scoped-text cascade as `findAssistantBubbleAt`.
 *            When ALL scoped selectors are empty, this reader falls back to
 *            `bubble.textContent` minus the assistant-toolbar's textContent
 *            (the "Class B fallback") — load-bearing for tool-only-response
 *            bubbles (gen-UI, recharts, A2UI cards) whose content lives in
 *            non-cascade children. The fallback is safe ONLY on the LAST
 *            bubble (by RUN_FINISHED its content has mounted), which is why
 *            it lives here and NOT in `readCascadeState` / `findAssistantBubbleAt`
 *            (those address arbitrary indices and would re-introduce the
 *            cross-bubble flap PR #5462 fixed).
 *   - When no tier matches: `{ count: 0, text: null }`.
 *
 * Implementation note: the closure body references `querySelectorAll` AND
 * `textContent` AND the literal `{ count` — the unit-test fakes dispatch on
 * those substrings to route the evaluate call to the cascade-state branch.
 */
export async function readCascadeStateLast(
  page: Page,
): Promise<{ count: number; text: string | null }> {
  try {
    return await page.evaluate(() => {
      interface DomElement {
        readonly textContent: string | null;
        querySelector(sel: string): DomElement | null;
      }
      interface DomNodeList {
        readonly length: number;
        item(idx: number): DomElement | null;
      }
      const doc = (
        globalThis as unknown as {
          document: { querySelectorAll(sel: string): DomNodeList };
        }
      ).document;
      const tiers: Array<{ bubble: string; textSelectors: string[] }> = [
        {
          bubble: '[data-testid="copilot-assistant-message"]',
          textSelectors: ["[data-message-content]", ".cpk\\:prose", ".prose"],
        },
        {
          bubble: '[role="article"][data-message-role="assistant"]',
          textSelectors: ["[data-message-content]", "p"],
        },
        {
          bubble: '[role="article"]:not([data-message-role="user"])',
          textSelectors: ["[data-message-content]", "p"],
        },
        {
          bubble: '[data-message-role="assistant"]',
          textSelectors: ["[data-message-content]", "p"],
        },
      ];
      for (const tier of tiers) {
        const list = doc.querySelectorAll(tier.bubble);
        if (list.length > 0) {
          const count = list.length;
          // Read the LAST bubble in the matched tier (count - 1) — see
          // function docstring for why "last" rather than a strict index.
          const lastIdx = count - 1;
          const bubble = list.item(lastIdx);
          if (!bubble) return { count, text: null };
          for (const textSel of tier.textSelectors) {
            const scoped = bubble.querySelector(textSel);
            if (scoped !== null) {
              const t = scoped.textContent ?? "";
              if (t.trim().length > 0) {
                return { count, text: t };
              }
            }
          }
          // Class B fallback: tool-only-response bubbles where ALL scoped
          // text selectors are empty but the bubble has substantial content
          // in non-cascade children (recharts SVG text, gen-UI / A2UI cards,
          // tool-call render output, etc.). Use `bubble.textContent` EXCLUDING
          // the toolbar (the LGP-pill / post-message area), so we capture the
          // real rendered content without re-introducing the toolbar-icon /
          // suggestion-pill pollution the scoped cascade was added to prevent.
          //
          // This is gated to the LAST bubble for two reasons:
          //   (a) `readCascadeStateLast` only reads the last bubble — by
          //       RUN_FINISHED the last bubble's non-cascade children have
          //       fully mounted, so whole-bubble text is stable.
          //   (b) intermediate bubbles in multi-step responses can transiently
          //       carry empty scoped text while the NEXT bubble is mounting;
          //       reading whole-bubble there would re-introduce the
          //       cross-bubble text flap r4f2 (PR #5462) sought to prevent.
          // The toolbar is a leaf sibling of the prose div, so its textContent
          // is the trailing slice of the bubble's full textContent — strip it
          // by suffix when present.
          const toolbar = bubble.querySelector(
            '[data-testid="copilot-assistant-toolbar"]',
          );
          const wholeText = bubble.textContent ?? "";
          const toolbarText =
            toolbar !== null ? (toolbar.textContent ?? "") : "";
          let contentText = wholeText;
          if (toolbarText.length > 0 && contentText.endsWith(toolbarText)) {
            contentText = contentText.slice(
              0,
              contentText.length - toolbarText.length,
            );
          }
          const trimmed = contentText.trim();
          if (trimmed.length > 0) {
            return { count, text: trimmed };
          }
          // Still nothing — keep the settle gate polling rather than locking
          // onto an empty placeholder.
          return { count, text: null };
        }
      }
      return { count: 0, text: null };
    });
  } catch (err) {
    console.warn(
      `[assistant-message-count] readCascadeStateLast: ${(err as Error).message ?? err}`,
    );
    return { count: 0, text: null };
  }
}

/**
 * Pure sibling of the scoped-text cascade inside `findAssistantBubbleAt`'s
 * `page.evaluate` closure. Kept in lock-step with the closure body so unit
 * tests can exercise the empty-textContent fall-through without JSDOM.
 *
 * Contract: walk `textSelectors` in order; for each selector return its
 * `textContent` only when non-empty/non-whitespace; otherwise fall through
 * to the next selector. After exhausting `textSelectors`, return `null` —
 * the closure body MUST NOT fall back to `bubble.textContent`, which would
 * re-introduce the LGP suggestion-pill / assistant-toolbar pollution this
 * scoped cascade exists to prevent.
 *
 * Any change to the closure's per-tier scoped-text loop MUST be mirrored
 * here, and vice-versa.
 */
export interface BubbleTextElement {
  readonly textContent: string | null;
  querySelector(sel: string): BubbleTextElement | null;
}
export function resolveBubbleTextFromSelectors(
  bubble: BubbleTextElement,
  textSelectors: readonly string[],
): string | null {
  for (const textSel of textSelectors) {
    const scoped = bubble.querySelector(textSel);
    if (scoped !== null) {
      const t = scoped.textContent ?? "";
      if (t.trim().length > 0) {
        return t;
      }
    }
  }
  // No scoped selector produced non-empty text. Return null instead of
  // `bubble.textContent` so the settle gate keeps polling rather than
  // locking onto the polluted whole-bubble text (toolbar icons, LGP
  // suggestion-pill text). See `findAssistantBubbleAt` for the rationale.
  return null;
}
