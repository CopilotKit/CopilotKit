import { useContext, useEffect, useRef } from "react";
import { LastUserMessageContext } from "../components/chat/last-user-message-context";

export type UsePinToSendOptions = {
  scrollRef: React.RefObject<HTMLElement | null>;
  contentRef: React.RefObject<HTMLElement | null>;
  spacerRef: React.RefObject<HTMLElement | null>;
  topOffset?: number;
};

export function usePinToSend({
  scrollRef,
  contentRef,
  spacerRef,
  topOffset = 16,
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

    // The target message's element has a top padding (e.g. `pt-10`) that
    // creates breathing room above the visible bubble. When we "anchor at
    // the top", we mean anchor the *bubble*, not the element's padded box.
    // So we scroll past the padding (it goes above the viewport, hiding
    // whatever was above the element too — including the previous message's
    // trailing copy button).
    const viewportHeight = scrollEl.clientHeight;
    const userMessageHeight = targetEl.getBoundingClientRect().height;
    const paddingTop = parseFloat(getComputedStyle(targetEl).paddingTop) || 0;
    const bubbleHeight = Math.max(0, userMessageHeight - paddingTop);
    const spacerHeight = Math.max(0, viewportHeight - bubbleHeight - topOffset);

    spacerEl.style.height = `${spacerHeight}px`;
    currentSpacerHeightRef.current = spacerHeight;

    const raf = requestAnimationFrame(() => {
      // Scroll so the BUBBLE is `topOffset` from the viewport top — the
      // padding above the bubble ends up scrolled off-screen.
      const targetTop =
        computeOffsetTop(targetEl, scrollEl) + paddingTop - topOffset;
      scrollEl.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    });

    // Shrink-only ResizeObserver: as the assistant response grows below the
    // anchored user message, collapse the spacer by the same amount so total
    // scrollable space below the bubble stays constant (and the bubble stays
    // pinned). Never grow the spacer after initial sizing.
    const ro = new ResizeObserver(() => {
      if (!contentEl || !spacerEl || !scrollEl) return;
      const contentHeight = contentEl.getBoundingClientRect().height;
      const targetOffsetWithinContent = computeOffsetTop(targetEl, contentEl);
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
  }, [id, sendNonce, scrollRef, contentRef, spacerRef, topOffset]);
}

// Compute the offset of el relative to stopAt, accounting for stopAt's current scrollTop.
// Uses getBoundingClientRect so it works regardless of CSS positioning (including position:static).
function computeOffsetTop(el: HTMLElement, stopAt: HTMLElement): number {
  const elRect = el.getBoundingClientRect();
  const stopRect = stopAt.getBoundingClientRect();
  return elRect.top - stopRect.top + stopAt.scrollTop;
}
