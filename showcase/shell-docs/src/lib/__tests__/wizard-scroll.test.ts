import { describe, expect, it, vi } from "vitest";
import {
  easeInOutCubic,
  prefersReducedMotion,
  scrollElementIntoCenter,
  WIZARD_SCROLL_DURATION_MS,
} from "@/lib/wizard-scroll";

/**
 * This runs in the Node environment (no jsdom). `scrollElementIntoCenter`
 * only ever touches `getBoundingClientRect`, `window.scrollY`, and
 * `window.innerHeight` directly, plus the fully injectable `now`,
 * `requestFrame`, and `scrollTo`. A plain object that supplies those exact
 * reads is behaviorally identical to a real DOM element for this function,
 * so a fake is sufficient — pulling in jsdom would only add setup cost
 * without exercising any code path the fake doesn't already cover.
 */
function fakeElement(rectTop: number, height: number): HTMLElement {
  return {
    getBoundingClientRect: () =>
      ({
        top: rectTop,
        height,
      }) as DOMRect,
  } as unknown as HTMLElement;
}

describe("easeInOutCubic", () => {
  it("maps the endpoints", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
  });

  it("maps the midpoint to 0.5", () => {
    expect(easeInOutCubic(0.5)).toBe(0.5);
  });

  it("is monotonically increasing", () => {
    const samples = Array.from({ length: 10 }, (_, i) => i / 9);
    const values = samples.map(easeInOutCubic);

    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });
});

describe("WIZARD_SCROLL_DURATION_MS", () => {
  it("is 650", () => {
    expect(WIZARD_SCROLL_DURATION_MS).toBe(650);
  });
});

describe("prefersReducedMotion", () => {
  it("returns false when window or matchMedia is absent", () => {
    // In the Node test environment there is no `window` global at all,
    // which is exactly the guard this function exists to exercise.
    expect(prefersReducedMotion()).toBe(false);
  });
});

function withFakeWindow(scrollY: number, innerHeight: number) {
  (globalThis as { window?: unknown }).window = {
    scrollY,
    innerHeight,
  };
}

describe("scrollElementIntoCenter", () => {
  const originalWindow = globalThis.window;

  function restoreWindow() {
    (globalThis as { window?: unknown }).window = originalWindow;
  }

  it("reduced motion: calls scrollTo exactly once with the final target and never requests a frame", () => {
    withFakeWindow(0, 800);
    try {
      const element = fakeElement(1000, 200);
      const scrollTo = vi.fn();
      const requestFrame = vi.fn();

      scrollElementIntoCenter(element, {
        reducedMotion: true,
        scrollTo,
        requestFrame,
      });

      // target = rect.top + scrollY - (viewportHeight - height) / 2
      //        = 1000 + 0 - (800 - 200) / 2 = 700
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith(700);
      expect(requestFrame).not.toHaveBeenCalled();
    } finally {
      restoreWindow();
    }
  });

  it("animated: requests frames, never overshoots, and lands exactly on target on the last call", () => {
    withFakeWindow(0, 800);
    try {
      const element = fakeElement(1000, 200);
      const target = 700;
      const scrollCalls: number[] = [];
      const scrollTo = (top: number) => scrollCalls.push(top);

      let time = 0;
      const now = () => time;

      // Drive the animation manually: each call to requestFrame stashes the
      // callback, and the test advances the clock and invokes it itself.
      // This is the injectable-dependency point of the whole module.
      const frameDurationMs = 100;
      const requestFrame = (cb: (t: number) => void) => {
        time += frameDurationMs;
        cb(time);
      };

      scrollElementIntoCenter(element, {
        reducedMotion: false,
        durationMs: WIZARD_SCROLL_DURATION_MS,
        now,
        requestFrame,
        scrollTo,
      });

      expect(scrollCalls.length).toBeGreaterThan(1);
      for (const value of scrollCalls) {
        expect(value).toBeLessThanOrEqual(target);
      }
      expect(scrollCalls[scrollCalls.length - 1]).toBe(target);
    } finally {
      restoreWindow();
    }
  });
});
