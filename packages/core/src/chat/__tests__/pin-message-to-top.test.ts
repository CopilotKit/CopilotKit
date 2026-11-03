// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ɵpinMessageToTop } from "../viewport";

/** Gives `el` a fixed height and top for layout reads jsdom does not do. */
function layout(el: HTMLElement, { top = 0, height = 0 }) {
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: height,
  });
  el.getBoundingClientRect = () => new DOMRect(0, top, 100, height);
}

/**
 * A 600px scroll container with a 100px message (`m1`, 40px top padding) at
 * 200px inside 300px of content, and a spacer.
 */
function chat() {
  const scrollEl = document.createElement("div");
  const contentEl = document.createElement("div");
  const message = document.createElement("div");
  const spacerEl = document.createElement("div");
  message.dataset.messageId = "m1";
  message.style.paddingTop = "40px";
  contentEl.append(message);
  scrollEl.append(contentEl, spacerEl);
  document.body.append(scrollEl);
  layout(scrollEl, { height: 600 });
  layout(contentEl, { height: 300 });
  layout(message, { top: 200, height: 100 });
  scrollEl.scrollTo = vi.fn();
  return { scrollEl, contentEl, spacerEl, message };
}

/** A ResizeObserver whose callback the test runs with `trigger()`. */
class FakeResizeObserver {
  static observing = new Set<FakeResizeObserver>();
  readonly #callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe() {
    FakeResizeObserver.observing.add(this);
  }
  unobserve() {}
  disconnect() {
    FakeResizeObserver.observing.delete(this);
  }
  trigger() {
    this.#callback([], this);
  }
}

/** Collects frame callbacks and observers so the test runs them by hand. */
function stubFrameAndResize() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(nextFrame, callback);
    return nextFrame++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  FakeResizeObserver.observing.clear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const runFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const frame of pending) frame(0);
  };
  const resize = () => {
    const observers = [...FakeResizeObserver.observing];
    for (const observer of observers) observer.trigger();
  };
  return { runFrames, resize, frames };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("ɵpinMessageToTop", () => {
  it("sizes the spacer so the bubble can reach the top", () => {
    stubFrameAndResize();
    const { scrollEl, contentEl, spacerEl } = chat();

    ɵpinMessageToTop({ scrollEl, contentEl, spacerEl, messageId: "m1" });

    // 600 viewport - (100 - 40 padding) bubble - 16 offset.
    expect(spacerEl.style.height).toBe("524px");
  });

  it("scrolls the bubble to the top offset on the next frame", () => {
    const { runFrames } = stubFrameAndResize();
    const { scrollEl, contentEl, spacerEl } = chat();

    ɵpinMessageToTop({
      scrollEl,
      contentEl,
      spacerEl,
      messageId: "m1",
      topOffset: 10,
    });
    expect(scrollEl.scrollTo).not.toHaveBeenCalled();
    runFrames();

    // 200 top + 40 padding - 10 offset.
    expect(scrollEl.scrollTo).toHaveBeenCalledWith({
      top: 230,
      behavior: "smooth",
    });
  });

  it("shrinks the spacer as the reply below grows", () => {
    const { resize } = stubFrameAndResize();
    const { scrollEl, contentEl, spacerEl } = chat();
    ɵpinMessageToTop({ scrollEl, contentEl, spacerEl, messageId: "m1" });

    layout(contentEl, { height: 500 });
    resize();

    // 500 content - 200 top - 100 message = 200 below; 524 - 200.
    expect(spacerEl.style.height).toBe("324px");
  });

  it("stops the scroll and the spacer updates once unpinned", () => {
    const { resize, frames } = stubFrameAndResize();
    const { scrollEl, contentEl, spacerEl } = chat();
    const unpin = ɵpinMessageToTop({
      scrollEl,
      contentEl,
      spacerEl,
      messageId: "m1",
    });

    unpin();
    layout(contentEl, { height: 500 });
    resize();

    expect(frames.size).toBe(0);
    expect(spacerEl.style.height).toBe("524px");
  });

  it("finds ids with selector characters", () => {
    stubFrameAndResize();
    const { scrollEl, contentEl, spacerEl, message } = chat();
    message.dataset.messageId = 'a"b]c';

    ɵpinMessageToTop({ scrollEl, contentEl, spacerEl, messageId: 'a"b]c' });

    expect(spacerEl.style.height).toBe("524px");
  });

  it("does nothing when the message is not rendered", () => {
    stubFrameAndResize();
    const { scrollEl, contentEl, spacerEl } = chat();

    ɵpinMessageToTop({ scrollEl, contentEl, spacerEl, messageId: "other" })();

    expect(spacerEl.style.height).toBe("");
  });

  it("still sizes the spacer without requestAnimationFrame or ResizeObserver", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
    vi.stubGlobal("ResizeObserver", undefined);
    const { scrollEl, contentEl, spacerEl } = chat();

    const unpin = ɵpinMessageToTop({
      scrollEl,
      contentEl,
      spacerEl,
      messageId: "m1",
    });
    unpin();

    expect(spacerEl.style.height).toBe("524px");
    expect(scrollEl.scrollTo).not.toHaveBeenCalled();
  });
});
