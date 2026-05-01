import { useContext, useEffect, useRef } from "react";
import { LastUserMessageContext } from "../components/chat/last-user-message-context";

export type UsePinToSendOptions = {
  scrollRef: React.RefObject<HTMLElement | null>;
  contentRef: React.RefObject<HTMLElement | null>;
  spacerRef: React.RefObject<HTMLElement | null>;
  topOffset?: number;
};

// Anchors the most recent user message at `topOffset` from the viewport top
// when a new message is sent and keeps it there as later content (assistant
// response, suggestions, late-arriving tool calls) reflows the layout.
//
// Approach: a sibling spacer below `contentRef` extends `scrollHeight` by
// exactly the amount needed for the bubble to reach `topOffset`, then a
// ResizeObserver shrinks it as natural content fills the gap. The spacer
// lives *outside* `contentRef` so any custom layout inside (e.g. flex
// containers that push suggestions to the bottom of the message area) is
// preserved verbatim. We also re-issue the scroll-to-top whenever
// `contentRef` resizes (until the user scrolls), so suggestions appearing
// after generation don't leave the bubble drifting away from the top.
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

    // The user-message element has a top padding (`pt-10`) that creates
    // breathing room above the visible bubble. We anchor the *bubble* — the
    // padding scrolls off-screen above the viewport.
    const viewportHeight = scrollEl.clientHeight;
    const paddingTop = parseFloat(getComputedStyle(targetEl).paddingTop) || 0;

    // Required scrollHeight to land the bubble at `topOffset`. Includes
    // `paddingTop` because the bubble sits paddingTop pixels below the
    // element's top edge.
    const computeRequired = () => {
      const userMsgOffset = computeOffsetTop(targetEl, scrollEl);
      return userMsgOffset + paddingTop + viewportHeight - topOffset;
    };

    // The spacer is a sibling of `contentRef` inside `scrollRef`. So
    // scrollHeight = contentRef.height + spacer.height. We size the spacer
    // to make up the gap between the natural content height and the
    // required scrollHeight — no over-allocation, no double-counting of the
    // input-overlay paddingBottom that already lives inside `contentRef`.
    const computeSpacer = () => {
      const required = computeRequired();
      const contentHeight = contentEl.getBoundingClientRect().height;
      return Math.max(0, required - contentHeight);
    };

    const initialSpacer = computeSpacer();
    spacerEl.style.height = `${initialSpacer}px`;
    currentSpacerHeightRef.current = initialSpacer;

    // Track user-initiated scrolls via wheel/touch/keyboard so we know when
    // to stop re-anchoring. The browser's `scroll` event also fires for our
    // own programmatic `scrollTo`, so we listen to input events instead.
    let userScrolled = false;
    const markScrolled = () => {
      userScrolled = true;
    };
    scrollEl.addEventListener("wheel", markScrolled, { passive: true });
    scrollEl.addEventListener("touchmove", markScrolled, { passive: true });
    const onKey = (e: KeyboardEvent) => {
      const navKeys = [
        "ArrowUp",
        "ArrowDown",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        " ",
      ];
      if (navKeys.includes(e.key)) userScrolled = true;
    };
    scrollEl.addEventListener("keydown", onKey);

    const reanchor = (behavior: ScrollBehavior) => {
      const targetTop =
        computeOffsetTop(targetEl, scrollEl) + paddingTop - topOffset;
      scrollEl.scrollTo({ top: Math.max(0, targetTop), behavior });
    };

    const raf = requestAnimationFrame(() => reanchor("smooth"));

    // As `contentRef` reflows (response streaming, suggestions appearing,
    // toolbar showing on generation end, etc.) two things can happen:
    //   1. Natural content grows past the spacer, making the spacer
    //      irrelevant — shrink it so we don't lock in extra scroll area.
    //   2. The bubble's offset within `scrollEl` shifts (e.g. an earlier
    //      message reflows, or the suggestion area pushes the bubble up).
    //      Re-anchor to keep the bubble at `topOffset`.
    const ro = new ResizeObserver(() => {
      if (!contentEl || !spacerEl || !scrollEl) return;
      const newSpacer = computeSpacer();
      if (newSpacer < currentSpacerHeightRef.current) {
        spacerEl.style.height = `${newSpacer}px`;
        currentSpacerHeightRef.current = newSpacer;
      }
      if (!userScrolled) reanchor("auto");
    });
    ro.observe(contentEl);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scrollEl.removeEventListener("wheel", markScrolled);
      scrollEl.removeEventListener("touchmove", markScrolled);
      scrollEl.removeEventListener("keydown", onKey);
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
