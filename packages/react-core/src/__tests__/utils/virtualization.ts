import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { Message } from "@ag-ui/core";

/**
 * A scroll container the message view will virtualize inside. jsdom reports
 * no layout, and the view only virtualizes when its scroll container has a
 * real height, so this one claims 600px.
 */
export function createScrollElement(): HTMLDivElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientHeight", {
    get: () => 600,
    configurable: true,
  });
  element.getBoundingClientRect = () =>
    ({
      height: 600,
      width: 800,
      top: 0,
      left: 0,
      bottom: 600,
      right: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return element;
}

/** TanStack Virtual schedules measurement frames; let them run before teardown. */
export async function drainAnimationFrames(): Promise<void> {
  await act(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
}

/** `count` user messages with ids `${prefix}-0` … and content `${prefix} 0` … */
export function userMessages(count: number, prefix = "m"): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    role: "user" as const,
    content: `${prefix} ${i}`,
  }));
}

/**
 * A scroll container whose virtual window really moves. Unlike
 * {@link createScrollElement}, `scrollTop` is writable (and dispatches the
 * scroll event TanStack Virtual listens for), `scrollTo` updates it, and every
 * virtual row measures `rowHeight` px, so scrolling mounts and unmounts rows
 * as a browser would. Call within a test; the global stubs are undone by
 * `vi.unstubAllGlobals()` and `vi.restoreAllMocks()`.
 */
export function createScrollableElement(rowHeight = 100): {
  element: HTMLDivElement;
  scrollTo: (offset: number) => Promise<void>;
} {
  const element = createScrollElement();
  let top = 0;
  const setTop = (value: number) => {
    top = value;
    element.dispatchEvent(new Event("scroll"));
  };
  Object.defineProperty(element, "scrollTop", {
    get: () => top,
    set: setTop,
    configurable: true,
  });
  for (const [name, value] of [
    ["offsetHeight", 600],
    ["offsetWidth", 800],
  ] as const) {
    Object.defineProperty(element, name, {
      get: () => value,
      configurable: true,
    });
  }
  element.scrollTo = ((options: ScrollToOptions) =>
    setTop(options.top ?? 0)) as typeof element.scrollTo;

  // jsdom has no ResizeObserver, without which the virtualizer never reads
  // the viewport and renders no rows.
  if (typeof window.ResizeObserver === "undefined") {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  }
  // jsdom lays nothing out, so every row would measure 0 px and share one
  // offset. Give virtual rows (the elements carrying `data-index`) a height.
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.dataset.index === undefined) return realRect.call(this);
      return {
        height: rowHeight,
        width: 800,
        top: 0,
        left: 0,
        bottom: rowHeight,
        right: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    },
  );

  return {
    element,
    scrollTo: async (offset: number) => {
      await act(async () => setTop(offset));
      await drainAnimationFrames();
    },
  };
}
