// Auto-scroll-to-bottom for the hand-rolled headless chat.
//
// `listRef` goes on the inner content node. The hook walks up to the
// nearest Radix `[data-slot='scroll-area-viewport']` ancestor. Radix wraps
// content in a `display: table` div, so `h-full` doesn't propagate and the
// ref cannot go on the scrollable element directly.
//
// `stickRef.current` is the read/write knob. While it is true, every
// render pins the list to the bottom. The scroll listener sets it to false
// when the user scrolls more than 80px above the bottom. Callers pin again
// by setting `stickRef.current = true` (for example, on send or reset).

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export function useAutoScroll<T>(messages: T[], isRunning: boolean) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<Element | null>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    viewportRef.current = node.closest("[data-slot='scroll-area-viewport']");
  }, []);

  const onScroll = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = distance < 80;
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  useLayoutEffect(() => {
    if (!stickRef.current) return;
    const el = viewportRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    } else {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages, isRunning]);

  return { listRef, bottomRef, stickRef };
}
