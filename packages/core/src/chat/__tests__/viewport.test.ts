import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ɵMOBILE_MAX_WIDTH_QUERY,
  ɵinitialKeyboardState,
  ɵisMobileViewport,
  ɵnormalizeAutoScroll,
  ɵreadKeyboardState,
  ɵwatchKeyboardState,
  ɵwatchMobileViewport,
} from "../viewport";

/** A media query list whose `matches` the test flips with `change(next)`. */
function fakeMediaQuery(initial: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initial,
    addEventListener: (_type: "change", listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_type: "change", listener: () => void) =>
      listeners.delete(listener),
  };
  const queries: string[] = [];
  vi.stubGlobal("window", {
    matchMedia: (media: string) => {
      queries.push(media);
      return query;
    },
  });
  const change = (next: boolean) => {
    query.matches = next;
    for (const listener of listeners) listener();
  };
  return { change, queries, listeners };
}

/** A window whose visual viewport height the test sets with `resize(h)`. */
function fakeVisualViewport(innerHeight: number, visualHeight: number) {
  const listeners = new Map<string, Set<() => void>>();
  const visualViewport = {
    height: visualHeight,
    addEventListener: (type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: () => void) =>
      listeners.get(type)?.delete(listener),
  };
  vi.stubGlobal("window", { innerHeight, visualViewport });
  const resize = (height: number) => {
    visualViewport.height = height;
    for (const listener of listeners.get("resize") ?? []) listener();
  };
  const listenerCount = () =>
    [...listeners.values()].reduce((total, set) => total + set.size, 0);
  return { resize, listenerCount };
}

afterEach(() => vi.unstubAllGlobals());

describe("ɵnormalizeAutoScroll", () => {
  it.each([
    [undefined, "pin-to-bottom"],
    [true, "pin-to-bottom"],
    [false, "none"],
    ["pin-to-bottom", "pin-to-bottom"],
    ["pin-to-send", "pin-to-send"],
    ["none", "none"],
  ] as const)("maps %s to %s", (value, expected) => {
    expect(ɵnormalizeAutoScroll(value)).toBe(expected);
  });

  it("falls back to pin-to-bottom for an unknown string from untyped code", () => {
    // Templates and plain JavaScript can pass any string.
    const fromUntypedCode = JSON.parse('"bogus"');

    expect(ɵnormalizeAutoScroll(fromUntypedCode)).toBe("pin-to-bottom");
  });
});

describe("ɵisMobileViewport", () => {
  it("is false without a window", () => {
    expect(ɵisMobileViewport()).toBe(false);
  });

  it("is false without matchMedia", () => {
    vi.stubGlobal("window", {});

    expect(ɵisMobileViewport()).toBe(false);
  });

  it("reads the mobile query", () => {
    const { queries } = fakeMediaQuery(true);

    expect(ɵisMobileViewport()).toBe(true);
    expect(queries).toEqual(["(max-width: 767px)"]);
    expect(ɵMOBILE_MAX_WIDTH_QUERY).toBe("(max-width: 767px)");
  });
});

describe("ɵwatchMobileViewport", () => {
  it("reports now and on each change until unsubscribed", () => {
    const { change, listeners } = fakeMediaQuery(false);
    const seen: boolean[] = [];

    const unsubscribe = ɵwatchMobileViewport((isMobile) => seen.push(isMobile));
    change(true);
    unsubscribe();
    change(false);

    expect(seen).toEqual([false, true]);
    expect(listeners.size).toBe(0);
  });

  it("does nothing without matchMedia", () => {
    vi.stubGlobal("window", {});
    const listener = vi.fn();

    ɵwatchMobileViewport(listener)();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("ɵreadKeyboardState", () => {
  it("reports a closed keyboard and zero heights without a window", () => {
    expect(ɵreadKeyboardState()).toEqual({
      isKeyboardOpen: false,
      keyboardHeight: 0,
      availableHeight: 0,
      viewportHeight: 0,
    });
  });

  it("reports the full window height without the Visual Viewport API", () => {
    vi.stubGlobal("window", { innerHeight: 900, visualViewport: null });

    expect(ɵreadKeyboardState()).toEqual({
      isKeyboardOpen: false,
      keyboardHeight: 0,
      availableHeight: 900,
      viewportHeight: 900,
    });
  });

  it("is open once the keyboard covers more than 150px", () => {
    fakeVisualViewport(800, 500);

    expect(ɵreadKeyboardState()).toEqual({
      isKeyboardOpen: true,
      keyboardHeight: 300,
      availableHeight: 500,
      viewportHeight: 800,
    });
  });

  it("stays closed at exactly 150px", () => {
    fakeVisualViewport(800, 650);

    expect(ɵreadKeyboardState().isKeyboardOpen).toBe(false);
  });

  it("clamps a visual viewport taller than the window to zero", () => {
    fakeVisualViewport(800, 820);

    expect(ɵreadKeyboardState().keyboardHeight).toBe(0);
  });
});

describe("ɵinitialKeyboardState", () => {
  it("starts closed over the full window, even with the keyboard up", () => {
    fakeVisualViewport(800, 500);

    expect(ɵinitialKeyboardState()).toEqual({
      isKeyboardOpen: false,
      keyboardHeight: 0,
      availableHeight: 800,
      viewportHeight: 800,
    });
  });
});

describe("ɵwatchKeyboardState", () => {
  it("reports now and on each resize until unsubscribed", () => {
    const { resize, listenerCount } = fakeVisualViewport(800, 800);
    const heights: number[] = [];

    const unsubscribe = ɵwatchKeyboardState((state) =>
      heights.push(state.keyboardHeight),
    );
    resize(400);
    unsubscribe();
    resize(800);

    expect(heights).toEqual([0, 400]);
    expect(listenerCount()).toBe(0);
  });

  it("does nothing without the Visual Viewport API", () => {
    vi.stubGlobal("window", { innerHeight: 800, visualViewport: null });
    const listener = vi.fn();

    ɵwatchKeyboardState(listener)();

    expect(listener).not.toHaveBeenCalled();
  });
});
