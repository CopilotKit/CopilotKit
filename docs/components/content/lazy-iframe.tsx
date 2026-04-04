"use client";

import { useRef, useState, useEffect } from "react";

interface LazyIframeProps {
  src: string;
  className?: string;
  style?: React.CSSProperties;
}

function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

export function LazyIframe({ src, className, style }: LazyIframeProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined);
  const scrollLocked = useRef(false);
  const savedScrollTop = useRef(0);

  // Lazy-load: only set src when the iframe is near the scroll viewport
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const container = getScrollParent(el);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          const target = container ?? document.documentElement;
          savedScrollTop.current = target.scrollTop;
          scrollLocked.current = true;
          setLoadedSrc(src);
          observer.disconnect();
        }
      },
      { root: container, rootMargin: "400px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [src]);

  // Lock scroll position until user interacts, preventing focus-triggered scroll
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const container = getScrollParent(el);
    const target = container ?? document.documentElement;

    const onScroll = () => {
      if (scrollLocked.current) {
        target.scrollTop = savedScrollTop.current;
      }
    };

    // Any user gesture means they want to scroll — unlock
    const unlock = () => {
      scrollLocked.current = false;
    };

    target.addEventListener("scroll", onScroll);
    window.addEventListener("wheel", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", unlock);
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  return (
    <iframe ref={ref} src={loadedSrc} className={className} style={style} />
  );
}
