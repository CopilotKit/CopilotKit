/**
 * Tests for `_hitl-shared.ts` — the shared HITL helpers (selector
 * cascades, dialog click drivers, follow-up message readers).
 *
 * Focus areas:
 *   - `pickTimeSlot` must NOT compose double-prefixed selectors. The
 *     historical bug had the cascade entries themselves include
 *     `[data-testid="time-picker-card"] ...`; combined with the
 *     in-helper `${cardSelector} ${entry}` prefixing this produced
 *     selectors like
 *     `[data-testid="time-picker-card"] [data-testid="time-picker-card"] button >> nth=0`
 *     which never match because nested cards don't exist.
 *   - The fall-through cascade still resolves to a card-relative
 *     button selector when the canonical slot testid isn't present.
 */

import { describe, expect, it } from "vitest";
import { pickTimeSlot, selectorCascade, type Page } from "./_hitl-shared.js";

interface SeenSelector {
  method: "waitForSelector" | "click";
  selector: string;
}

function makePage(opts: {
  // Predicate that decides whether a given waitForSelector call is
  // allowed to "resolve". Selectors that fail rejection cascade onward.
  resolves: (selector: string) => boolean;
  seen: SeenSelector[];
}): Page {
  return {
    async waitForSelector(selector: string): Promise<unknown> {
      opts.seen.push({ method: "waitForSelector", selector });
      if (opts.resolves(selector)) return undefined;
      throw new Error(`no match: ${selector}`);
    },
    async fill() {},
    async press() {},
    async click(selector: string): Promise<void> {
      opts.seen.push({ method: "click", selector });
    },
    async evaluate<R>(_fn: () => R): Promise<R> {
      return undefined as unknown as R;
    },
  };
}

describe("pickTimeSlot — selector composition", () => {
  it("never composes a doubled card-shaped prefix into the slot selector", async () => {
    // Resolve every card-cascade probe AND every slot-cascade probe so
    // the helper walks both fully. We assert on the SHAPE of the
    // probed selectors: none of them may contain the substring
    // `time-picker-card] [data-testid="time-picker-card"`, which would
    // be the smoking gun of the historical double-prefix bug (a
    // card-shaped string appearing twice in a single composed
    // selector).
    const seen: SeenSelector[] = [];
    const page = makePage({ resolves: () => true, seen });
    await pickTimeSlot(page);

    for (const s of seen) {
      const occurrences = s.selector.match(
        /\[data-testid="time-picker-card"\]/g,
      );
      expect(
        (occurrences?.length ?? 0) <= 1,
        `selector should contain card testid at most once, got: ${s.selector}`,
      ).toBe(true);
    }
  });

  it("clicks a slot selector that is anchored under the resolved card selector", async () => {
    // Force the cascade to land on the canonical card testid (first
    // entry resolves) and the canonical slot testid (first entry
    // resolves). The click target must be the card selector composed
    // with the slot selector — not the bare slot selector and not the
    // card selector alone.
    const seen: SeenSelector[] = [];
    const page = makePage({ resolves: () => true, seen });
    await pickTimeSlot(page);

    const clicks = seen.filter((s) => s.method === "click");
    expect(clicks).toHaveLength(1);
    const composed = clicks[0]!.selector;
    expect(composed).toContain('[data-testid="time-picker-card"]');
    expect(composed).toContain('[data-testid="time-picker-slot"]');
  });

  it("falls through to the button>>nth=0 cascade entry when no slot testid present", async () => {
    // Resolve the card-cascade canonical testid but reject the slot
    // canonical testid; the helper should then probe the button-by-
    // index entry. Anchoring under the resolved cardSelector means
    // the probed selector is `[card] button >> nth=0` — NOT
    // `[card] [card] button >> nth=0`.
    const seen: SeenSelector[] = [];
    const resolves = (selector: string): boolean => {
      // Card cascade: only resolve the canonical testid.
      if (selector === '[data-testid="time-picker-card"]') return true;
      // Slot cascade: reject the canonical slot testid so we fall
      // through to the next cascade entry.
      if (selector.includes('[data-testid="time-picker-slot"]')) return false;
      // Anything else (the fallback button>>nth=0 entry) resolves.
      return true;
    };
    const page = makePage({ resolves, seen });
    await pickTimeSlot(page);

    const clicks = seen.filter((s) => s.method === "click");
    expect(clicks).toHaveLength(1);
    const composed = clicks[0]!.selector;
    // Card prefix + bare button index — NO doubled card prefix.
    expect(composed).toContain('[data-testid="time-picker-card"]');
    expect(composed).toContain("button");
    expect(composed).toContain("nth=0");
    const cardOccurrences = composed.match(
      /\[data-testid="time-picker-card"\]/g,
    );
    expect(cardOccurrences?.length).toBe(1);
  });
});

describe("selectorCascade — true Promise race", () => {
  it("probes ALL selectors concurrently (call timestamps cluster, not 3s apart)", async () => {
    // Per docstring: selectorCascade RACES selectors. Sequential probing
    // would space out waitForSelector calls by SELECTOR_PROBE_TIMEOUT_MS
    // (~3s) on each miss; concurrent probing dispatches all of them in
    // the same microtask tick. We assert the call timestamps are
    // clustered within a small window (~50ms allowance for scheduler
    // jitter) regardless of how many of them eventually reject.
    const callTimes: number[] = [];
    const start = Date.now();
    // Three selectors: the third resolves, the first two reject after
    // a short delay. If the cascade is sequential, the third selector's
    // call wouldn't fire until after the first two finished rejecting;
    // if it's a true race, all three calls are dispatched ~immediately.
    const page: Page = {
      async waitForSelector(selector: string): Promise<unknown> {
        callTimes.push(Date.now() - start);
        if (selector === "third") {
          return new Promise((resolve) => setTimeout(resolve, 20));
        }
        return new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error(`miss: ${selector}`)), 50),
        );
      },
      async fill() {},
      async press() {},
      async click() {},
      async evaluate<R>(_fn: () => R): Promise<R> {
        return undefined as unknown as R;
      },
    };

    const winner = await selectorCascade(
      page,
      ["first", "second", "third"],
      "test",
    );
    expect(winner).toBe("third");
    expect(callTimes).toHaveLength(3);
    const spread = Math.max(...callTimes) - Math.min(...callTimes);
    // Concurrent dispatch: all calls inside the same tick → spread is
    // tiny (~few ms). Sequential dispatch with 50ms rejects would
    // produce a spread well over 50ms. 50ms tolerates scheduler jitter
    // while still failing loudly on accidental sequential probing.
    expect(
      spread,
      `expected concurrent dispatch (spread <50ms), got ${spread}ms`,
    ).toBeLessThan(50);
  });

  it("throws with consolidated detail listing every tried selector when all reject", async () => {
    const page: Page = {
      async waitForSelector(selector: string): Promise<unknown> {
        throw new Error(`no match: ${selector}`);
      },
      async fill() {},
      async press() {},
      async click() {},
      async evaluate<R>(_fn: () => R): Promise<R> {
        return undefined as unknown as R;
      },
    };
    await expect(selectorCascade(page, ["a", "b"], "thing")).rejects.toThrow(
      /thing not found/,
    );
    await expect(selectorCascade(page, ["a", "b"], "thing")).rejects.toThrow(
      /a/,
    );
    await expect(selectorCascade(page, ["a", "b"], "thing")).rejects.toThrow(
      /b/,
    );
  });

  it("returns the fast-resolving selector even when slower probes would also resolve", async () => {
    // Fast resolution wins regardless of cascade order — this is the
    // race semantic the docstring promises.
    const page: Page = {
      async waitForSelector(selector: string): Promise<unknown> {
        if (selector === "slow") {
          return new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (selector === "fast") {
          return new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error(`unexpected selector: ${selector}`);
      },
      async fill() {},
      async press() {},
      async click() {},
      async evaluate<R>(_fn: () => R): Promise<R> {
        return undefined as unknown as R;
      },
    };
    const winner = await selectorCascade(page, ["slow", "fast"], "test");
    expect(winner).toBe("fast");
  });
});
