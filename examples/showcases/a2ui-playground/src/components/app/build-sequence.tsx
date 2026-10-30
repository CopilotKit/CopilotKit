"use client";

/** Shared surface chrome for the chat renderer and the landing replay. */
import { useLayoutEffect, useRef, useState } from "react";

/** transitions.dev card resize: the box eases to its content height as the surface grows. */
export function ResizeBox({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    setH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      className={`t-resize relative ${className ?? ""}`}
      style={{ height: h }}
    >
      <div ref={inner}>{children}</div>
    </div>
  );
}
