import { describe, it, expect } from "vitest";
import type { Page } from "playwright";
import {
  readCascadeState,
  resolveBubbleTextFromSelectors,
} from "./assistant-message-count.js";
import type { BubbleTextElement } from "./assistant-message-count.js";

/**
 * Unit coverage for the empty-textContent fall-through inside
 * `findAssistantBubbleAt`'s scoped-text cascade. The cascade itself runs in
 * `page.evaluate` (browser context) so we cannot exercise the closure
 * directly without JSDOM (which the harness package does not depend on).
 * Instead, the closure's per-tier loop is mirrored in the pure helper
 * `resolveBubbleTextFromSelectors` exported alongside it — the two MUST
 * stay in lock-step; the contract test below pins the failure mode that
 * triggered this fix (data-message-content matches but is empty).
 */

interface StubBubble extends BubbleTextElement {
  readonly textContent: string | null;
  querySelector(sel: string): StubBubble | null;
}

function bubble(
  ownText: string | null,
  children: Record<string, { textContent: string | null }>,
): StubBubble {
  return {
    textContent: ownText,
    querySelector(sel: string): StubBubble | null {
      const hit = children[sel];
      if (!hit) return null;
      return {
        textContent: hit.textContent,
        querySelector(): StubBubble | null {
          return null;
        },
      };
    },
  };
}

describe("resolveBubbleTextFromSelectors", () => {
  it("returns first non-empty scoped selector match", () => {
    const b = bubble("full-bubble-text", {
      "[data-message-content]": { textContent: "scoped-content" },
      ".cpk\\:prose": { textContent: "should-not-reach" },
    });
    expect(
      resolveBubbleTextFromSelectors(b, [
        "[data-message-content]",
        ".cpk\\:prose",
      ]),
    ).toBe("scoped-content");
  });

  it("falls through empty [data-message-content] to .cpk:prose (Finding E / Bug 10)", () => {
    // Repro the exact failure mode: the wrapper that matches the FIRST
    // text selector is mounted but empty (e.g. mounted before children
    // populate, or used as a static-empty marker). The real streamed
    // text lives in the next selector. Pre-fix, the function returned ""
    // and the settle gate spun on `text-unstable` until timeout.
    const b = bubble("ignored-fallback", {
      "[data-message-content]": { textContent: "" },
      ".cpk\\:prose": { textContent: "real streamed answer" },
    });
    expect(
      resolveBubbleTextFromSelectors(b, [
        "[data-message-content]",
        ".cpk\\:prose",
        ".prose",
      ]),
    ).toBe("real streamed answer");
  });

  it("treats whitespace-only textContent as empty and falls through", () => {
    const b = bubble("ignored-fallback", {
      "[data-message-content]": { textContent: "   \n\t  " },
      ".cpk\\:prose": { textContent: "actual text" },
    });
    expect(
      resolveBubbleTextFromSelectors(b, [
        "[data-message-content]",
        ".cpk\\:prose",
      ]),
    ).toBe("actual text");
  });

  it("falls through null textContent to next selector", () => {
    const b = bubble("ignored-fallback", {
      "[data-message-content]": { textContent: null },
      p: { textContent: "paragraph text" },
    });
    expect(
      resolveBubbleTextFromSelectors(b, ["[data-message-content]", "p"]),
    ).toBe("paragraph text");
  });

  it("returns null instead of bubble.textContent when ALL scoped selectors are empty (cascade-pollution guard, Round 4 #3 / Bug 8)", () => {
    // The whole-bubble `textContent` conflates the message text with the
    // post-message UI affordances (LGP suggestion-pills, the canonical
    // assistant toolbar). Returning it would re-introduce the exact
    // pollution this scoped cascade exists to prevent. Returning `null`
    // keeps the settle gate polling until a scoped child populates.
    const b = bubble("whole-bubble-pollution-incl-LGP-pills-and-toolbar", {
      "[data-message-content]": { textContent: "" },
      ".cpk\\:prose": { textContent: "  " },
    });
    expect(
      resolveBubbleTextFromSelectors(b, [
        "[data-message-content]",
        ".cpk\\:prose",
      ]),
    ).toBeNull();
  });

  it("returns null instead of bubble.textContent when no scoped selectors match at all", () => {
    // Same cascade-pollution guard: when no scoped child matches, the
    // whole bubble's textContent is just as polluted as when scoped
    // children matched but were empty. Return null in both cases.
    const b = bubble("only-fallback-pollution", {});
    expect(
      resolveBubbleTextFromSelectors(b, [
        "[data-message-content]",
        ".cpk\\:prose",
      ]),
    ).toBeNull();
  });

  it("returns null when neither scoped nor bubble textContent is present", () => {
    // The settle-gate caller's guard is `text !== null && text.trim().length > 0`;
    // returning null keeps the gate polling rather than locking onto an
    // empty placeholder or synthesising a bogus value.
    const b = bubble(null, {
      "[data-message-content]": { textContent: "" },
    });
    expect(
      resolveBubbleTextFromSelectors(b, ["[data-message-content]"]),
    ).toBeNull();
  });

  it("does not invoke later selectors after the first non-empty match", () => {
    let prose_lookups = 0;
    const stub: BubbleTextElement = {
      textContent: "irrelevant",
      querySelector(sel: string): BubbleTextElement | null {
        if (sel === "[data-message-content]") {
          return {
            textContent: "winning text",
            querySelector(): BubbleTextElement | null {
              return null;
            },
          };
        }
        if (sel === ".cpk\\:prose") {
          prose_lookups += 1;
          return {
            textContent: "later",
            querySelector(): BubbleTextElement | null {
              return null;
            },
          };
        }
        return null;
      },
    };
    expect(
      resolveBubbleTextFromSelectors(stub, [
        "[data-message-content]",
        ".cpk\\:prose",
      ]),
    ).toBe("winning text");
    expect(prose_lookups).toBe(0);
  });
});

/**
 * Unit coverage for `readCascadeState` — the atomic single-`page.evaluate`
 * reader that returns BOTH the cascade count and the indexed text from the
 * SAME tier in one round-trip. The closure body is invoked client-side by
 * Playwright; for unit purposes we drive it via a fake `Page.evaluate` that
 * sets up `globalThis.document` and EXECUTES the closure body directly.
 * This is the same shape as the production browser context — the closure
 * uses `globalThis.document.querySelectorAll` and `bubble.querySelector`.
 *
 * The tests pin the cross-tier consistency property the helper exists for:
 * count and text MUST come from the same tier.
 */
interface StubNode {
  textContent: string | null;
  querySelector?(sel: string): StubNode | null;
}

function makeDoc(tiersFound: Record<string, StubNode[]>): {
  querySelectorAll: (sel: string) => {
    length: number;
    item: (i: number) => StubNode | null;
  };
} {
  return {
    querySelectorAll(sel: string) {
      const list = tiersFound[sel] ?? [];
      return {
        length: list.length,
        item(i: number): StubNode | null {
          return list[i] ?? null;
        },
      };
    },
  };
}

/**
 * Build a fake Playwright `Page` whose `evaluate` runs the closure body
 * directly in a sandbox where `globalThis.document` is `doc`. The closure
 * receives its second runtime arg (here `bubbleIndex`) as Playwright would.
 */
function makePageForCascade(doc: ReturnType<typeof makeDoc>): Page {
  return {
    async evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fn: (...args: any[]) => unknown,
      arg?: unknown,
    ): Promise<unknown> {
      const origDoc = (globalThis as unknown as { document?: unknown })
        .document;
      (globalThis as unknown as { document: unknown }).document = doc;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (fn as (a: any) => unknown)(arg);
      } finally {
        (globalThis as unknown as { document: unknown }).document = origDoc;
      }
    },
  } as unknown as Page;
}

describe("readCascadeState", () => {
  const CANONICAL = '[data-testid="copilot-assistant-message"]';
  const ARTICLE_ROLE = '[role="article"][data-message-role="assistant"]';
  const ARTICLE_NOT_USER = '[role="article"]:not([data-message-role="user"])';
  const HEADLESS = '[data-message-role="assistant"]';

  function leafBubble(textContent: string | null): StubNode {
    return {
      textContent,
      querySelector(_sel: string): StubNode | null {
        return null;
      },
    };
  }

  function scopedBubble(
    children: Record<string, { textContent: string | null }>,
  ): StubNode {
    return {
      textContent: "ignored-whole-bubble",
      querySelector(sel: string): StubNode | null {
        const c = children[sel];
        if (!c) return null;
        return leafBubble(c.textContent);
      },
    };
  }

  it("returns canonical tier count + scoped text when tier 1 matches", async () => {
    const b0 = scopedBubble({
      "[data-message-content]": { textContent: "first answer" },
    });
    const b1 = scopedBubble({
      "[data-message-content]": { textContent: "second answer" },
    });
    const doc = makeDoc({ [CANONICAL]: [b0, b1] });
    const page = makePageForCascade(doc);

    const r0 = await readCascadeState(page, 0);
    expect(r0).toEqual({ count: 2, text: "first answer" });
    const r1 = await readCascadeState(page, 1);
    expect(r1).toEqual({ count: 2, text: "second answer" });
  });

  it("returns text:null instead of polluted whole-bubble fallback when scoped children are empty (cascade-pollution guard)", async () => {
    // The canonical bubble's whole `textContent` includes the toolbar +
    // LGP suggestion-pill text; returning it would re-introduce the
    // exact pollution the scoped cascade exists to prevent. The atomic
    // reader returns text:null so the settle-gate keeps polling.
    const polluted = {
      textContent: "TOOLBAR-PILLS-POLLUTION",
      querySelector(sel: string): StubNode | null {
        if (sel === "[data-message-content]") return leafBubble("");
        if (sel === ".cpk\\:prose") return leafBubble("  ");
        if (sel === ".prose") return leafBubble("\n\t");
        return null;
      },
    };
    const doc = makeDoc({ [CANONICAL]: [polluted] });
    const page = makePageForCascade(doc);

    const r = await readCascadeState(page, 0);
    expect(r).toEqual({ count: 1, text: null });
  });

  it("returns {count:0, text:null} when NO tier matches at all (empty DOM)", async () => {
    const doc = makeDoc({}); // no tiers found
    const page = makePageForCascade(doc);
    const r = await readCascadeState(page, 0);
    expect(r).toEqual({ count: 0, text: null });
  });

  it("returns {count, text:null} when bubbleIndex is out of range within the matched tier", async () => {
    const b0 = scopedBubble({
      "[data-message-content]": { textContent: "only one" },
    });
    const doc = makeDoc({ [CANONICAL]: [b0] });
    const page = makePageForCascade(doc);

    // bubbleIndex=1 is out of range (only 1 bubble at index 0).
    const r = await readCascadeState(page, 1);
    expect(r).toEqual({ count: 1, text: null });
  });

  it("count and text come from the SAME tier (cross-tier consistency)", async () => {
    // Canonical tier has 3 bubbles, headless tier has 7. The closure picks
    // the FIRST tier whose length > 0 (canonical wins) and reads both
    // count and indexed text from that tier — NOT from headless.
    const canonical = [
      scopedBubble({ "[data-message-content]": { textContent: "c-0" } }),
      scopedBubble({ "[data-message-content]": { textContent: "c-1" } }),
      scopedBubble({ "[data-message-content]": { textContent: "c-2" } }),
    ];
    const headless = [
      scopedBubble({ "[data-message-content]": { textContent: "h-0" } }),
      scopedBubble({ "[data-message-content]": { textContent: "h-1" } }),
      scopedBubble({ "[data-message-content]": { textContent: "h-2" } }),
      scopedBubble({ "[data-message-content]": { textContent: "h-3" } }),
      scopedBubble({ "[data-message-content]": { textContent: "h-4" } }),
      scopedBubble({ "[data-message-content]": { textContent: "h-5" } }),
      scopedBubble({ "[data-message-content]": { textContent: "h-6" } }),
    ];
    const doc = makeDoc({ [CANONICAL]: canonical, [HEADLESS]: headless });
    const page = makePageForCascade(doc);

    const r = await readCascadeState(page, 2);
    // Same-tier guarantee: count=3 (canonical), text="c-2" (canonical),
    // never count=7 / text="h-2" (cross-tier).
    expect(r).toEqual({ count: 3, text: "c-2" });
  });

  it("falls through to a later tier when canonical has zero matches", async () => {
    const articleBubble = scopedBubble({
      "[data-message-content]": { textContent: "article-text" },
    });
    const doc = makeDoc({
      [ARTICLE_ROLE]: [articleBubble],
    });
    const page = makePageForCascade(doc);

    const r = await readCascadeState(page, 0);
    expect(r).toEqual({ count: 1, text: "article-text" });
  });

  it("tier 3 article-not-user matches when role+role+assistant tiers are empty", async () => {
    const b = scopedBubble({ p: { textContent: "non-user article" } });
    const doc = makeDoc({ [ARTICLE_NOT_USER]: [b] });
    const page = makePageForCascade(doc);

    const r = await readCascadeState(page, 0);
    expect(r).toEqual({ count: 1, text: "non-user article" });
  });

  it("models count growth across polls — same atomic reader returns the new tier-count + text", async () => {
    // Simulate the mid-stream race: poll 1 sees 1 bubble at the canonical
    // tier, poll 2 sees 2 bubbles (a new bubble mounted). With the atomic
    // reader, both reads in each poll come from the SAME tier — no
    // cross-tier inconsistency.
    let polls = 0;
    const polled = (): ReturnType<typeof makeDoc> => {
      polls += 1;
      const list: StubNode[] = [
        scopedBubble({
          "[data-message-content]": { textContent: "bubble-0" },
        }),
      ];
      if (polls >= 2) {
        list.push(
          scopedBubble({
            "[data-message-content]": { textContent: "bubble-1" },
          }),
        );
      }
      return makeDoc({ [CANONICAL]: list });
    };

    const r1 = await readCascadeState(makePageForCascade(polled()), 0);
    expect(r1).toEqual({ count: 1, text: "bubble-0" });

    const r2 = await readCascadeState(makePageForCascade(polled()), 1);
    expect(r2).toEqual({ count: 2, text: "bubble-1" });
  });

  it("swallows page.evaluate throws and returns {count:0, text:null}", async () => {
    const page: Page = {
      async evaluate(): Promise<unknown> {
        throw new Error("browser-eval-blew-up");
      },
    } as unknown as Page;

    const r = await readCascadeState(page, 0);
    expect(r).toEqual({ count: 0, text: null });
  });
});
