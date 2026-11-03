import { useContext, useEffect, useRef } from "react";
import { ɵpinMessageToTop } from "@copilotkit/core";
import { LastUserMessageContext } from "../components/chat/last-user-message-context";

export type UsePinToSendOptions = {
  scrollRef: React.RefObject<HTMLElement | null>;
  contentRef: React.RefObject<HTMLElement | null>;
  spacerRef: React.RefObject<HTMLElement | null>;
  topOffset?: number;
};

/**
 * Pins the latest sent user message near the top of the chat while the reply
 * streams below it. Core's `ɵpinMessageToTop` does the measuring and
 * scrolling; this hook runs it once per send.
 */
export function usePinToSend({
  scrollRef,
  contentRef,
  spacerRef,
  topOffset = 16,
}: UsePinToSendOptions): void {
  const { id, sendNonce } = useContext(LastUserMessageContext);
  const lastNonceRef = useRef<number>(-1);

  useEffect(() => {
    if (sendNonce === lastNonceRef.current) return;
    const previousNonce = lastNonceRef.current;
    lastNonceRef.current = sendNonce;

    if (!id) return;
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    const spacerEl = spacerRef.current;
    if (!scrollEl || !contentEl || !spacerEl) return;

    const unpin = ɵpinMessageToTop({
      scrollEl,
      contentEl,
      spacerEl,
      messageId: id,
      topOffset,
    });
    return () => {
      // Torn down before the scroll ran, as React's StrictMode does right
      // after mount (the first send mounts the message list): let the next
      // run pin this send again. Skipping it would leave the spacer at its
      // full height for good, with nothing to shrink it as the reply grows.
      if (!unpin()) lastNonceRef.current = previousNonce;
    };
  }, [id, sendNonce, scrollRef, contentRef, spacerRef, topOffset]);
}
