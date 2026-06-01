import { inject, watch, type Ref } from "vue";
import {
  LastUserMessageKey,
  createDefaultLastUserMessageRef,
} from "../components/chat/last-user-message-context";

export interface UsePinToSendOptions {
  scrollRef: Ref<HTMLElement | null>;
  contentRef: Ref<HTMLElement | null>;
  spacerRef: Ref<HTMLElement | null>;
  topOffset?: number;
}

/**
 * Vue counterpart of React's `usePinToSend` (`packages/react-core/src/v2/hooks/use-pin-to-send.ts`).
 *
 * Anchors the chat scroll container so the most recent user message stays
 * pinned near the top of the viewport while the assistant streams a
 * response beneath it.
 *
 * Implementation parity with React:
 * - Reads the latest user message via the `LastUserMessageContext`
 *   equivalent (`LastUserMessageKey` + `Ref<LastUserMessageState>`).
 * - On each `sendNonce` increment, sizes the spacer to
 *   `viewportHeight - bubbleHeight - topOffset` and scrolls so the bubble
 *   sits `topOffset` from the viewport top (padding above the bubble is
 *   pushed off-screen).
 * - Installs a shrink-only `ResizeObserver` on `contentRef` that collapses
 *   the spacer as the assistant response grows; never grows it back.
 * - Cancels the scheduled `requestAnimationFrame` and disconnects the
 *   `ResizeObserver` on subsequent re-runs and on scope dispose.
 */
export function usePinToSend({
  scrollRef,
  contentRef,
  spacerRef,
  topOffset = 16,
}: UsePinToSendOptions): void {
  const lastUserMessage = inject(
    LastUserMessageKey,
    createDefaultLastUserMessageRef(),
    true,
  );

  let lastNonce = -1;
  let currentSpacerHeight = 0;
  let raf: number | null = null;
  let ro: ResizeObserver | null = null;

  function teardown() {
    if (raf !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(raf);
    }
    raf = null;
    ro?.disconnect();
    ro = null;
  }

  watch(
    [
      () => lastUserMessage.value.id,
      () => lastUserMessage.value.sendNonce,
      scrollRef,
      contentRef,
      spacerRef,
      () => topOffset,
    ],
    ([id, sendNonce, scrollEl, contentEl, spacerEl], _old, onCleanup) => {
      // Always tear down the previous run's RAF / ResizeObserver before
      // evaluating any of the early-exit guards below. Mirrors React
      // `useEffect` cleanup semantics: the prior run's cleanup runs before
      // the next callback executes regardless of why the deps changed.
      // Without this, a reactive `autoScroll` mode change (e.g. switching
      // away from `"pin-to-send"`) or a `ref` swap that doesn't bump
      // `sendNonce` would leak the stale content-element observer because
      // the nonce guard skips the body. Registering via `onCleanup` also
      // covers watcher stop on scope dispose, so an explicit
      // `onScopeDispose(teardown)` is no longer required.
      onCleanup(teardown);

      if (sendNonce === lastNonce) return;
      lastNonce = sendNonce;

      if (!id) return;
      if (!scrollEl || !contentEl || !spacerEl) return;

      const escaped =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
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
      const spacerHeight = Math.max(
        0,
        viewportHeight - bubbleHeight - topOffset,
      );

      spacerEl.style.height = `${spacerHeight}px`;
      currentSpacerHeight = spacerHeight;

      if (typeof requestAnimationFrame === "function") {
        raf = requestAnimationFrame(() => {
          // Scroll so the BUBBLE is `topOffset` from the viewport top — the
          // padding above the bubble ends up scrolled off-screen.
          const targetTop =
            computeOffsetTop(targetEl, scrollEl) + paddingTop - topOffset;
          scrollEl.scrollTo({
            top: Math.max(0, targetTop),
            behavior: "smooth",
          });
        });
      }

      // Shrink-only ResizeObserver: as the assistant response grows below the
      // anchored user message, collapse the spacer by the same amount so total
      // scrollable space below the bubble stays constant (and the bubble stays
      // pinned). Never grow the spacer after initial sizing.
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => {
          if (!contentEl || !spacerEl || !scrollEl) return;
          const contentHeight = contentEl.getBoundingClientRect().height;
          const targetOffsetWithinContent = computeOffsetTop(
            targetEl,
            contentEl,
          );
          const consumedBelow =
            contentHeight - targetOffsetWithinContent - userMessageHeight;
          const remaining = Math.max(0, spacerHeight - consumedBelow);
          if (remaining < currentSpacerHeight) {
            spacerEl.style.height = `${remaining}px`;
            currentSpacerHeight = remaining;
          }
        });
        ro.observe(contentEl);
      }
    },
    { immediate: true, flush: "post" },
  );
}

// Compute the offset of el relative to stopAt, accounting for stopAt's current scrollTop.
// Uses getBoundingClientRect so it works regardless of CSS positioning (including position:static).
function computeOffsetTop(el: HTMLElement, stopAt: HTMLElement): number {
  const elRect = el.getBoundingClientRect();
  const stopRect = stopAt.getBoundingClientRect();
  return elRect.top - stopRect.top + stopAt.scrollTop;
}
