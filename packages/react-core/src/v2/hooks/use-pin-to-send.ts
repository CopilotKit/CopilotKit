import { useContext, useEffect, useRef } from "react";
import { LastUserMessageContext } from "../components/chat/last-user-message-context";

export type UsePinToSendOptions = {
  scrollRef: React.RefObject<HTMLElement | null>;
  contentRef: React.RefObject<HTMLElement | null>;
  topOffset?: number;
};

// Apply a transient min-height to the scroll content so the newly sent user
// message can scroll to `topOffset` from the viewport top, then let natural
// content (the streaming assistant response, suggestions, etc.) take over as
// it grows past that floor. This mirrors the ChatGPT / Claude behavior:
// user message pinned to top, response streams in below, no extra scrollable
// whitespace tacked on after generation.
export function usePinToSend({
  scrollRef,
  contentRef,
  topOffset = 16,
}: UsePinToSendOptions): void {
  const { id, sendNonce } = useContext(LastUserMessageContext);
  const lastNonceRef = useRef<number>(-1);

  useEffect(() => {
    if (sendNonce === lastNonceRef.current) return;
    lastNonceRef.current = sendNonce;

    if (!id) return;
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;

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
    const paddingTop = parseFloat(getComputedStyle(targetEl).paddingTop) || 0;
    const userMsgOffsetInScroll = computeOffsetTop(targetEl, scrollEl);

    // The minimum scrollHeight that lets the bubble land at `topOffset` from
    // the viewport top is: `bubbleTop + viewportHeight - topOffset`, where
    // `bubbleTop = userMsgOffsetInScroll + paddingTop`. We apply this as a
    // min-height on the content element. Once the natural content (response,
    // padding, suggestions) grows past this floor, the floor is irrelevant
    // and the layout reflects only the actual content — no leftover spacer
    // whitespace at the bottom after generation.
    const requiredScrollHeight =
      userMsgOffsetInScroll + paddingTop + viewportHeight - topOffset;
    contentEl.style.minHeight = `${Math.max(0, requiredScrollHeight)}px`;

    const raf = requestAnimationFrame(() => {
      // Scroll so the BUBBLE is `topOffset` from the viewport top — the
      // padding above the bubble ends up scrolled off-screen.
      const targetTop = userMsgOffsetInScroll + paddingTop - topOffset;
      scrollEl.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    });

    return () => {
      cancelAnimationFrame(raf);
      // Clear the floor on cleanup so a subsequent send (with a different
      // user-message position) starts from a clean slate.
      contentEl.style.minHeight = "";
    };
  }, [id, sendNonce, scrollRef, contentRef, topOffset]);
}

// Compute the offset of el relative to stopAt, accounting for stopAt's current scrollTop.
// Uses getBoundingClientRect so it works regardless of CSS positioning (including position:static).
function computeOffsetTop(el: HTMLElement, stopAt: HTMLElement): number {
  const elRect = el.getBoundingClientRect();
  const stopRect = stopAt.getBoundingClientRect();
  return elRect.top - stopRect.top + stopAt.scrollTop;
}
