import { describe, expect, it, vi } from "vitest";
import {
  easeInOutCubic,
  findScrollContainer,
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

/**
 * A plain object standing in for the scroll container: settable `scrollTop`
 * (so a test can read back what the animation wrote) plus the box metrics
 * the position maths reads. Duck-typed as `HTMLElement` at the call site,
 * same idiom as `fakeElement` above.
 */
type FakeContainer = {
  scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  getBoundingClientRect: () => DOMRect;
};

function fakeContainer(config: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  rectTop: number;
}): FakeContainer {
  return {
    scrollTop: config.scrollTop,
    clientHeight: config.clientHeight,
    scrollHeight: config.scrollHeight,
    getBoundingClientRect: () => ({ top: config.rectTop }) as DOMRect,
  };
}

/**
 * A fake ancestor node for exercising `findScrollContainer`'s walk directly,
 * without a real DOM/CSSOM. `overflowY` is read back by the test's stub
 * `getComputedStyleFn` rather than any real computed style.
 */
type FakeNode = {
  parentElement: FakeNode | null;
  overflowY: string;
  scrollHeight: number;
  clientHeight: number;
};

function fakeGetComputedStyle(
  el: Element,
): Pick<CSSStyleDeclaration, "overflowY"> {
  return { overflowY: (el as unknown as FakeNode).overflowY };
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

  it("with a scrollable ancestor, writes to that container's scrollTop and never calls the window scroll path", () => {
    const element = fakeElement(500, 100);
    const container = fakeContainer({
      scrollTop: 50,
      clientHeight: 592,
      scrollHeight: 2074,
      rectTop: 0,
    });
    // target = container.scrollTop + rect.top - containerRect.top
    //          - (container.clientHeight - rect.height) / 2
    //        = 50 + 500 - 0 - (592 - 100) / 2 = 550 - 246 = 304
    const target = 304;

    const scrollTo = vi.fn();
    let time = 0;
    const now = () => time;
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
      findScrollContainer: () => container as unknown as HTMLElement,
    });

    expect(container.scrollTop).toBe(target);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("with no scrollable ancestor, still scrolls the window as before", () => {
    withFakeWindow(0, 800);
    try {
      const element = fakeElement(1000, 200);
      const target = 700;
      const scrollCalls: number[] = [];
      const scrollTo = (top: number) => scrollCalls.push(top);

      let time = 0;
      const now = () => time;
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
        findScrollContainer: () => null,
      });

      expect(scrollCalls.length).toBeGreaterThan(1);
      expect(scrollCalls[scrollCalls.length - 1]).toBe(target);
    } finally {
      restoreWindow();
    }
  });

  it("container path lands exactly on the clamped target on the final frame", () => {
    const element = fakeElement(500, 100);
    const container = fakeContainer({
      scrollTop: 50,
      clientHeight: 592,
      scrollHeight: 2074,
      rectTop: 0,
    });
    const target = 304; // see the computation in the test above

    let time = 0;
    const now = () => time;
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
      scrollTo: vi.fn(),
      findScrollContainer: () => container as unknown as HTMLElement,
    });

    expect(container.scrollTop).toBe(target);
  });

  it("clamps the container target so an element near the bottom does not scroll past scrollHeight - clientHeight", () => {
    const element = fakeElement(2000, 50);
    const container = fakeContainer({
      scrollTop: 1400,
      clientHeight: 592,
      scrollHeight: 2074,
      rectTop: 0,
    });
    // rawTarget = 1400 + 2000 - 0 - (592 - 50) / 2 = 3400 - 271 = 3129,
    // which is far past scrollHeight - clientHeight = 1482.
    const maxScrollTop = 2074 - 592;

    let time = 0;
    const now = () => time;
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
      scrollTo: vi.fn(),
      findScrollContainer: () => container as unknown as HTMLElement,
    });

    expect(container.scrollTop).toBe(maxScrollTop);
  });
});

describe("findScrollContainer", () => {
  it("skips an ancestor that is overflow-y: auto but does not actually overflow, and continues to a genuine scroller further up", () => {
    const genuineScroller: FakeNode = {
      parentElement: null,
      overflowY: "auto",
      scrollHeight: 2000,
      clientHeight: 600, // overflows: scrollHeight > clientHeight
    };
    const nonOverflowingWrapper: FakeNode = {
      parentElement: genuineScroller,
      overflowY: "auto",
      scrollHeight: 300,
      clientHeight: 300, // does not overflow
    };
    const element = {
      parentElement: nonOverflowingWrapper,
    } as unknown as HTMLElement;

    const result = findScrollContainer(element, fakeGetComputedStyle);

    expect(result).toBe(genuineScroller);
  });

  it("returns null when no ancestor scrolls", () => {
    const staticWrapper: FakeNode = {
      parentElement: null,
      overflowY: "visible",
      scrollHeight: 300,
      clientHeight: 300,
    };
    const element = {
      parentElement: staticWrapper,
    } as unknown as HTMLElement;

    const result = findScrollContainer(element, fakeGetComputedStyle);

    expect(result).toBeNull();
  });
});
