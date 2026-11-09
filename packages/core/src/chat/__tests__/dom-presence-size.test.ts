// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ɵcreateDockedSidebar,
  ɵcreateExitPresence,
  ɵisContentScrolledToBottom,
  ɵPOPUP_ANIMATION_MS,
  ɵRESIZE_SETTLE_MS,
  ɵwatchElementHeight,
  ɵwatchElementWidth,
} from "../dom";
import type { ɵElementHeightState, ɵExitPresenceState } from "../dom";

class FakeResizeObserver {
  static last: FakeResizeObserver | undefined;
  connected = true;
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.last = this;
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.connected = false;
  }
  /** Report a new content-box height. */
  report(height: number) {
    if (!this.connected) return;
    const entry = { contentRect: { height } } as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

function element(offsetHeight: number) {
  const el = document.createElement("div");
  Object.defineProperty(el, "offsetHeight", { value: offsetHeight });
  return el;
}

const rect = (values: Partial<DOMRect>) => () => values as DOMRect;

describe("ɵcreateExitPresence", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps a closed panel rendered until its exit animation ends", () => {
    const presence = ɵcreateExitPresence(true);
    const seen: ɵExitPresenceState[] = [];
    presence.subscribe((state) => seen.push(state));

    presence.setOpen(false);
    expect(presence.getState()).toEqual({ isRendered: true, isClosing: true });

    vi.advanceTimersByTime(ɵPOPUP_ANIMATION_MS - 1);
    expect(presence.getState().isRendered).toBe(true);
    vi.advanceTimersByTime(1);
    expect(presence.getState()).toEqual({
      isRendered: false,
      isClosing: false,
    });
    expect(seen).toHaveLength(2);
  });

  it("cancels the removal when the panel opens again", () => {
    const presence = ɵcreateExitPresence(true, { durationMs: 100 });
    presence.setOpen(false);
    presence.setOpen(true);
    vi.advanceTimersByTime(500);

    expect(presence.getState()).toEqual({ isRendered: true, isClosing: false });
  });

  it("renders nothing for a panel that starts closed", () => {
    const presence = ɵcreateExitPresence(false);
    presence.setOpen(false);

    expect(presence.getState().isRendered).toBe(false);
    presence.setOpen(true);
    expect(presence.getState().isRendered).toBe(true);
  });

  it("gives a new state object only on a change", () => {
    const presence = ɵcreateExitPresence(true);
    const before = presence.getState();
    presence.setOpen(true);
    expect(presence.getState()).toBe(before);
  });

  it("finishes the exit after a dispose and a new close", () => {
    const presence = ɵcreateExitPresence(true, { durationMs: 100 });
    presence.setOpen(false);
    presence.dispose();
    vi.advanceTimersByTime(500);
    expect(presence.getState().isRendered).toBe(true);

    // React's StrictMode runs the effects again with the same value.
    presence.setOpen(false);
    vi.advanceTimersByTime(100);
    expect(presence.getState().isRendered).toBe(false);
  });
});

describe("ɵwatchElementHeight", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports the first height without a resize", () => {
    const seen: ɵElementHeightState[] = [];
    ɵwatchElementHeight(element(80), (state) => seen.push(state));

    expect(seen).toEqual([{ height: 80, isResizing: false }]);
  });

  it("marks a height change as resizing until it settles", () => {
    const seen: ɵElementHeightState[] = [];
    ɵwatchElementHeight(element(80), (state) => seen.push(state));

    FakeResizeObserver.last?.report(120);
    vi.advanceTimersByTime(ɵRESIZE_SETTLE_MS - 1);
    FakeResizeObserver.last?.report(140);
    vi.advanceTimersByTime(ɵRESIZE_SETTLE_MS);

    expect(seen).toEqual([
      { height: 80, isResizing: false },
      { height: 120, isResizing: true },
      { height: 140, isResizing: true },
      { height: 140, isResizing: false },
    ]);
  });

  it("ignores observer calls that keep the same height", () => {
    const seen: ɵElementHeightState[] = [];
    ɵwatchElementHeight(element(80), (state) => seen.push(state));

    FakeResizeObserver.last?.report(80);

    expect(seen).toHaveLength(1);
  });

  it("stops reporting and drops the settle timer on stop", () => {
    const seen: ɵElementHeightState[] = [];
    const stop = ɵwatchElementHeight(element(80), (state) => seen.push(state));
    FakeResizeObserver.last?.report(120);

    stop();
    vi.advanceTimersByTime(ɵRESIZE_SETTLE_MS);
    FakeResizeObserver.last?.report(200);

    expect(seen.at(-1)).toEqual({ height: 120, isResizing: true });
  });
});

describe("ɵwatchElementWidth", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports the border-box width and skips zero widths", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const el = document.createElement("aside");
    let width = 480;
    el.getBoundingClientRect = () => ({ width }) as DOMRect;
    const seen: number[] = [];
    const stop = ɵwatchElementWidth(el, (next) => seen.push(next));

    width = 0;
    window.dispatchEvent(new Event("resize"));
    width = 360;
    window.dispatchEvent(new Event("resize"));
    stop();
    width = 200;
    window.dispatchEvent(new Event("resize"));

    expect(seen).toEqual([480, 360]);
  });
});

describe("ɵisContentScrolledToBottom", () => {
  it("compares the end of the content, not of the scroll area", () => {
    const scroll = document.createElement("div");
    const content = document.createElement("div");
    scroll.getBoundingClientRect = rect({ bottom: 500 });

    content.getBoundingClientRect = rect({ bottom: 512 });
    expect(ɵisContentScrolledToBottom(scroll, content)).toBe(true);
    content.getBoundingClientRect = rect({ bottom: 513 });
    expect(ɵisContentScrolledToBottom(scroll, content)).toBe(false);
    // An empty spacer below the content does not count.
    content.getBoundingClientRect = rect({ bottom: 100 });
    expect(ɵisContentScrolledToBottom(scroll, content)).toBe(true);
  });
});

describe("ɵDockedSidebar.isDocked", () => {
  afterEach(() => {
    document.body.style.marginInlineEnd = "";
  });

  it("tells whether this sidebar got the page margin", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = ɵcreateDockedSidebar(document, { transitionMs: 0 });
    const second = ɵcreateDockedSidebar(document, { transitionMs: 0 });
    const state = { open: true, position: "right", width: "480px" } as const;

    first.set(state);
    second.set(state);
    expect(first.isDocked).toBe(true);
    expect(second.isDocked).toBe(false);

    first.set({ ...state, open: false });
    expect(first.isDocked).toBe(false);
    first.dispose();
    second.dispose();
    warn.mockRestore();
  });
});
