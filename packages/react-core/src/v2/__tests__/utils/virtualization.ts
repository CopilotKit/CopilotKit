import { act } from "@testing-library/react";
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
