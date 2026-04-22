import { useContext, useEffect, useRef } from "react";
import { LastUserMessageContext } from "../components/chat/last-user-message-context";

export type UsePinToSendOptions = {
  scrollRef: React.RefObject<HTMLElement | null>;
  contentRef: React.RefObject<HTMLElement | null>;
  spacerRef: React.RefObject<HTMLElement | null>;
  topOffset?: number;
  inputContainerHeight?: number;
  featherHeight?: number;
};

export function usePinToSend({
  scrollRef,
  contentRef,
  spacerRef,
  topOffset = 16,
  inputContainerHeight = 0,
  featherHeight = 0,
}: UsePinToSendOptions): void {
  const { id, sendNonce } = useContext(LastUserMessageContext);
  const lastNonceRef = useRef<number>(-1);
  const currentSpacerHeightRef = useRef<number>(0);

  useEffect(() => {
    if (sendNonce === lastNonceRef.current) return;
    lastNonceRef.current = sendNonce;

    if (!id) return;
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    const spacerEl = spacerRef.current;
    if (!scrollEl || !contentEl || !spacerEl) return;

    const escaped =
      typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(id)
        : id.replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, "\\$&");
    const targetEl = contentEl.querySelector<HTMLElement>(
      `[data-message-id="${escaped}"]`,
    );
    if (!targetEl) return;

    const viewportHeight = scrollEl.clientHeight;
    const userMessageHeight = targetEl.getBoundingClientRect().height;
    const bottomChrome = inputContainerHeight + featherHeight;
    const spacerHeight = Math.max(
      0,
      viewportHeight - userMessageHeight - topOffset - bottomChrome,
    );

    spacerEl.style.height = `${spacerHeight}px`;
    currentSpacerHeightRef.current = spacerHeight;

    const raf = requestAnimationFrame(() => {
      const targetTop = computeOffsetTop(targetEl, scrollEl) - topOffset;
      scrollEl.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    });

    // Shrink-only ResizeObserver: as assistant response grows, collapse the spacer
    // so there's no wasted empty space. Never grow the spacer after initial sizing.
    const ro = new ResizeObserver(() => {
      if (!contentEl || !spacerEl || !scrollEl) return;
      const contentHeight = contentEl.getBoundingClientRect().height;
      const targetOffsetWithinContent = computeOffsetTop(targetEl, contentEl);
      // Space consumed by content below the anchored user message:
      const consumedBelow =
        contentHeight - targetOffsetWithinContent - userMessageHeight;
      const remaining = Math.max(0, spacerHeight - consumedBelow);
      if (remaining < currentSpacerHeightRef.current) {
        spacerEl.style.height = `${remaining}px`;
        currentSpacerHeightRef.current = remaining;
      }
    });
    ro.observe(contentEl);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [
    id,
    sendNonce,
    scrollRef,
    contentRef,
    spacerRef,
    topOffset,
    inputContainerHeight,
    featherHeight,
  ]);
}

// Compute the offset of el relative to stopAt, accounting for stopAt's current scrollTop.
// Uses getBoundingClientRect so it works regardless of CSS positioning (including position:static).
function computeOffsetTop(el: HTMLElement, stopAt: HTMLElement): number {
  const elRect = el.getBoundingClientRect();
  const stopRect = stopAt.getBoundingClientRect();
  return elRect.top - stopRect.top + stopAt.scrollTop;
}
