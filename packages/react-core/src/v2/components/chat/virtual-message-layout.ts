import type { Message } from "@ag-ui/core";
import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";

/** An initial estimate only; ResizeObserver remains the source of truth. */
export function estimateMessageHeight(message: Message, width: number): number {
  const content = message.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
        : "";
  if (!text) return 100;
  const columns = Math.max(20, Math.floor((width || 600) / 8));
  let inCode = false;
  let lines = 0;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inCode = !inCode;
      lines += 1;
    } else {
      lines += inCode ? 1 : Math.max(1, Math.ceil(line.length / columns));
    }
  }
  return Math.max(100, 48 + lines * 24);
}

export function shouldAdjustMessageScroll(
  item: VirtualItem,
  _delta: number,
  instance: Virtualizer<HTMLElement, Element>,
): boolean {
  // A row crossing the top edge can grow below the reading position. Moving
  // scrollTop by its entire size delta makes the visible text jump.
  // Wholly hidden rows shift every following message, including while
  // scrolling backward into newly measured overscan rows.
  return item.end <= (instance.scrollOffset ?? 0);
}
