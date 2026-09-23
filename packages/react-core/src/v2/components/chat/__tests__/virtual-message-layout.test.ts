import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  elementScroll,
  observeElementOffset,
  observeElementRect,
  Virtualizer,
} from "@tanstack/react-virtual";
import {
  estimateMessageHeight,
  shouldAdjustMessageScroll,
} from "../virtual-message-layout";

const longSql =
  "```sql\n" +
  Array.from({ length: 50 }, (_, i) => `SELECT ${i};`).join("\n") +
  "\n```";

function createScrollingList() {
  const scrollElement = document.createElement("div");
  Object.defineProperties(scrollElement, {
    offsetWidth: { value: 600 },
    offsetHeight: { value: 300 },
  });
  // jsdom has no layout or scrollTo implementation. Keep the actual
  // Virtualizer observers and elementScroll, supplying only DOM geometry.
  scrollElement.scrollTo = vi.fn((options: ScrollToOptions) => {
    scrollElement.scrollTop = options.top ?? 0;
  }) as typeof scrollElement.scrollTo;
  document.body.append(scrollElement);

  const instance = new Virtualizer<HTMLElement, Element>({
    count: 100,
    getScrollElement: () => scrollElement,
    estimateSize: () => 100,
    overscan: 5,
    scrollToFn: elementScroll,
    observeElementRect,
    observeElementOffset,
    measureElement: (element) => element.getBoundingClientRect().height,
    initialOffset: 6000,
  });
  instance.shouldAdjustScrollPositionOnItemSizeChange =
    shouldAdjustMessageScroll;
  const cleanup = instance._didMount();
  instance._willUpdate();
  onTestFinished(() => {
    cleanup();
    scrollElement.remove();
  });

  return {
    instance,
    scrollElement,
    scrollTo(offset: number) {
      scrollElement.scrollTop = offset;
      scrollElement.dispatchEvent(new Event("scroll"));
    },
    measure(index: number, height: number) {
      const row = document.createElement("div");
      row.dataset.index = String(index);
      row.getBoundingClientRect = () => new DOMRect(0, 0, 600, height);
      scrollElement.append(row);
      instance.measureElement(row);
    },
    rowTop(index: number) {
      instance.getTotalSize();
      return instance.measurementsCache[index]!.start - scrollElement.scrollTop;
    },
  };
}

describe("variable message heights", () => {
  it("uses multiline content to avoid a 100px estimate for a 50-line SQL block", () => {
    const short = { id: "short", role: "assistant" as const, content: "Hello" };
    const long = { ...short, id: "long", content: longSql };
    expect(estimateMessageHeight(short, 600)).toBe(100);
    expect(estimateMessageHeight(long, 600)).toBeGreaterThan(1200);
    expect(estimateMessageHeight(long, 320)).toBe(
      estimateMessageHeight(long, 600),
    );
  });

  it("accounts for wrapped prose and multimodal text", () => {
    const content = "a ".repeat(200);
    const message = {
      id: "user",
      role: "user" as const,
      content: [{ type: "text" as const, text: content }],
    };
    expect(estimateMessageHeight(message, 320)).toBeGreaterThan(
      estimateMessageHeight(message, 800),
    );
  });

  it.each([
    [0, 250, null, true],
    [2, 250, null, false],
    [4, 250, null, false],
    [0, 250, "backward", true],
    [2, 250, "backward", false],
  ] as const)(
    "adjusts row %s at offset %s scrolling %s only when wholly above the viewport",
    (index, offset, direction, adjusts) => {
      const scrollToFn = vi.fn();
      const instance = new Virtualizer<HTMLElement, Element>({
        count: 10,
        getScrollElement: () => null,
        estimateSize: () => 100,
        scrollToFn,
        observeElementRect: () => undefined,
        observeElementOffset: () => undefined,
        initialRect: { width: 600, height: 300 },
        initialOffset: offset,
      });
      instance.getTotalSize();
      instance.scrollOffset = offset;
      instance.scrollDirection = direction;
      instance.shouldAdjustScrollPositionOnItemSizeChange =
        shouldAdjustMessageScroll;
      instance.resizeItem(index, 1300);
      expect(scrollToFn).toHaveBeenCalledTimes(adjusts ? 1 : 0);
      expect(instance.getTotalSize()).toBe(2200);
    },
  );

  it.each([40, 1300])(
    "preserves the visible message when an upward overscan row measures %spx",
    (height) => {
      const list = createScrollingList();
      expect(list.instance.getVirtualIndexes()).not.toContain(45);

      // Scrolling upward mounts row 45 in overscan, entirely above row 50
      // at the viewport edge. Its first ref measurement replaces the estimate.
      list.scrollTo(5050);
      expect(list.instance.scrollDirection).toBe("backward");
      expect(list.instance.getVirtualIndexes()).toContain(45);
      const readingPosition = list.rowTop(50);

      list.measure(45, height);

      expect(list.scrollElement.scrollTop).toBe(5050 + height - 100);
      expect(list.rowTop(50)).toBe(readingPosition);
    },
  );

  it.each([40, 1300])(
    "does not move the partially visible row when it measures %spx while scrolling upward",
    (height) => {
      const list = createScrollingList();
      list.scrollTo(5050);
      expect(list.instance.scrollDirection).toBe("backward");
      const readingPosition = list.rowTop(50);

      list.measure(50, height);

      expect(list.scrollElement.scrollTop).toBe(5050);
      expect(list.rowTop(50)).toBe(readingPosition);
    },
  );
});
