import { inject, watch } from "vue";
import type { Ref } from "vue";
import { ɵpinMessageToTop } from "@copilotkit/core";
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
 * Vue counterpart of React's `usePinToSend` (`packages/react-core/src/hooks/use-pin-to-send.ts`).
 *
 * Anchors the chat scroll container so the most recent user message stays
 * pinned near the top of the viewport while the assistant streams a
 * response beneath it.
 *
 * Reads the latest user message via `LastUserMessageKey` and, on each
 * `sendNonce` increment, runs core's `ɵpinMessageToTop`, which sizes the
 * spacer, scrolls, and follows the reply's growth. The previous pin stops on
 * the next run and on scope dispose.
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
      if (sendNonce === lastNonce) return;
      lastNonce = sendNonce;

      if (!id) return;
      if (!scrollEl || !contentEl || !spacerEl) return;

      // Registered through `onCleanup`, so the previous pin stops before the
      // next run and when the watcher stops on scope dispose.
      onCleanup(
        ɵpinMessageToTop({
          scrollEl,
          contentEl,
          spacerEl,
          messageId: id,
          topOffset,
        }),
      );
    },
    { immediate: true, flush: "post" },
  );
}
