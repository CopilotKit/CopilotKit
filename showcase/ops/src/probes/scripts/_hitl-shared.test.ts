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
import { pickTimeSlot, type Page } from "./_hitl-shared.js";

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
