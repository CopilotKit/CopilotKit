import { describe, expect, it, vi } from "vitest";
import { Virtualizer } from "@tanstack/react-virtual";
import {
  estimateMessageHeight,
  shouldAdjustMessageScroll,
} from "../virtual-message-layout";

const longSql =
  "```sql\n" +
  Array.from({ length: 50 }, (_, i) => `SELECT ${i};`).join("\n") +
  "\n```";

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
    [0, 250, "backward", false],
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
});
