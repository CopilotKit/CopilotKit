// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ɵcreateStickToBottom } from "../viewport";
import type { ɵStickToBottomOptions } from "../viewport";

/** ResizeObservers the controller made, so a test can report a resize. */
const resizeObservers: FakeResizeObserver[] = [];

class FakeResizeObserver {
  readonly targets: Element[] = [];
  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    this.targets.length = 0;
  }
  resize() {
    if (this.targets.length === 0) return;
    this.callback([], this as unknown as ResizeObserver);
  }
}

/**
 * jsdom has no layout. This scroll container has a content height the test
 * sets, a 300px viewport, and a `scrollTo` that jumps (or, for smooth,
 * records the target and lets the test move step by step).
 */
function scrollBox(contentHeight: number) {
  const element = document.createElement("div");
  const content = document.createElement("div");
  element.appendChild(content);
  document.body.appendChild(element);
  let height = contentHeight;
  let top = 0;
  const smoothTargets: number[] = [];
  const maxTop = () => Math.max(0, height - 300);
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, get: () => height },
    clientHeight: { configurable: true, get: () => 300 },
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = Math.min(Math.max(0, value), maxTop());
      },
    },
  });
  element.scrollTo = ((options: ScrollToOptions) => {
    const target = Math.min(options.top ?? 0, maxTop());
    if (options.behavior === "smooth") smoothTargets.push(target);
    else top = target;
  }) as typeof element.scrollTo;

  return {
    element,
    content,
    smoothTargets,
    get top() {
      return top;
    },
    /** The reader (or an animation) moves the list and a scroll event fires. */
    scrollTo(next: number) {
      top = Math.min(Math.max(0, next), maxTop());
      element.dispatchEvent(new Event("scroll"));
    },
    /** The reader moves the list; its scroll event has not arrived yet. */
    moveWithoutEvent(next: number) {
      top = Math.min(Math.max(0, next), maxTop());
    },
    /** New content arrives; the browser fires no scroll event for it. */
    grow(by: number) {
      height += by;
    },
    /** Content goes away; the browser clamps `scrollTop` and fires a scroll. */
    shrink(by: number) {
      height -= by;
      const clamped = Math.min(top, maxTop());
      if (clamped === top) return;
      top = clamped;
      element.dispatchEvent(new Event("scroll"));
    },
    distanceFromEnd() {
      return height - top - 300;
    },
  };
}

function create(
  box: ReturnType<typeof scrollBox>,
  options: Partial<ɵStickToBottomOptions> = {},
) {
  const changes: boolean[] = [];
  const stick = ɵcreateStickToBottom({
    scrollElement: box.element,
    contentElement: box.content,
    onChange: (isAtBottom) => changes.push(isAtBottom),
    ...options,
  });
  return { stick, changes };
}

const resizeAll = () => resizeObservers.forEach((o) => o.resize());

describe("ɵStickToBottom", () => {
  beforeEach(() => {
    resizeObservers.length = 0;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("scrolls to the end when it starts", () => {
    const box = scrollBox(1000);
    create(box);

    expect(box.top).toBe(700);
  });

  it("follows content that grows while the reader is at the bottom", () => {
    const box = scrollBox(1000);
    const { stick } = create(box);

    box.grow(400);
    resizeAll();

    expect(box.distanceFromEnd()).toBe(0);
    expect(stick.isAtBottom).toBe(true);
  });

  it("follows DOM changes in the content without a resize event", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const box = scrollBox(1000);
    create(box);

    box.grow(200);
    box.content.appendChild(document.createElement("p"));
    await Promise.resolve();

    expect(box.distanceFromEnd()).toBe(0);
  });

  it("stops following when the reader scrolls up, and reports it", () => {
    const box = scrollBox(1000);
    const { stick, changes } = create(box);

    box.scrollTo(300);
    box.grow(400);
    resizeAll();

    expect(box.top).toBe(300);
    expect(stick.isAtBottom).toBe(false);
    expect(changes).toEqual([false]);
  });

  it("follows again once the reader scrolls back to the bottom", () => {
    const box = scrollBox(1000);
    const { stick, changes } = create(box);

    box.scrollTo(300);
    box.scrollTo(695); // within the 12px threshold
    box.grow(100);
    resizeAll();

    expect(box.distanceFromEnd()).toBe(0);
    expect(stick.isAtBottom).toBe(true);
    expect(changes).toEqual([false, true]);
  });

  it("stops following on a small step up inside the threshold", () => {
    const box = scrollBox(1000);
    const { stick, changes } = create(box);

    box.scrollTo(696); // 4px up, still within the 12px threshold
    box.grow(100);
    resizeAll();

    expect(box.top).toBe(696);
    expect(stick.isAtBottom).toBe(false);
    expect(changes).toEqual([false]);
  });

  it("stops following when the reader moves up before the scroll event arrives", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const box = scrollBox(1000);
    const { stick } = create(box);

    box.moveWithoutEvent(696);
    box.grow(100);
    box.content.appendChild(document.createElement("p"));
    await Promise.resolve();

    expect(box.top).toBe(696);
    expect(stick.isAtBottom).toBe(false);
  });

  it("keeps following when shrinking content pulls the list up", () => {
    const box = scrollBox(1000);
    const { stick } = create(box);

    box.shrink(100);
    box.grow(300);
    resizeAll();

    expect(box.distanceFromEnd()).toBe(0);
    expect(stick.isAtBottom).toBe(true);
  });

  it("keeps following when content grows before its own scroll event arrives", () => {
    const box = scrollBox(1000);
    const { stick } = create(box);

    // A token streams in between the instant scroll and its scroll event.
    box.grow(50);
    box.element.dispatchEvent(new Event("scroll"));
    resizeAll();

    expect(stick.isAtBottom).toBe(true);
    expect(box.distanceFromEnd()).toBe(0);
  });

  it("keeps following while a smooth scroll moves down, and stops when the reader scrolls up", () => {
    const box = scrollBox(1000);
    const { stick } = create(box, { followBehavior: "smooth" });

    box.grow(600);
    resizeAll();
    expect(box.smoothTargets).toEqual([1300]);

    box.scrollTo(900); // the animation moves down
    expect(stick.isAtBottom).toBe(true);

    box.scrollTo(850); // the reader scrolls up during the animation
    expect(stick.isAtBottom).toBe(false);
  });

  it("scrolls back down and follows again on scrollToBottom", () => {
    const box = scrollBox(1000);
    const { stick } = create(box);
    box.scrollTo(100);

    stick.scrollToBottom("instant");
    box.grow(100);
    resizeAll();

    expect(box.distanceFromEnd()).toBe(0);
    expect(stick.isAtBottom).toBe(true);
  });

  it("only tracks the position when it does not follow", () => {
    const box = scrollBox(1000);
    const { stick, changes } = create(box, { follow: false });

    expect(box.top).toBe(0);
    expect(changes).toEqual([false]);

    box.scrollTo(700);
    box.grow(100);
    resizeAll();
    expect(box.top).toBe(700);
    expect(stick.isAtBottom).toBe(false);
  });

  it("starts following when follow is turned on", () => {
    const box = scrollBox(1000);
    const { stick } = create(box, { follow: false });

    stick.setFollow(true);

    expect(box.distanceFromEnd()).toBe(0);
  });

  it("uses the threshold it is given", () => {
    const box = scrollBox(1000);
    const { stick } = create(box, { follow: false, threshold: 4 });

    box.scrollTo(695);
    expect(stick.isAtBottom).toBe(false);
    box.scrollTo(696);
    expect(stick.isAtBottom).toBe(true);
  });

  it("stops listening on dispose", () => {
    const box = scrollBox(1000);
    const { stick, changes } = create(box);

    stick.dispose();
    box.scrollTo(100);
    box.grow(100);
    resizeAll();

    expect(changes).toEqual([]);
    expect(box.top).toBe(100);
  });
});
