"use client";

import { useEffect, useRef } from "react";
import styles from "./pixel-matrix.module.css";

/**
 * The website's pixel matrix, in one look everywhere: white squares on a
 * stage ground (`MATRIX_GROUND` in stage.tsx), their color and strength set
 * once in theme.css (`--matrix-square`, `--matrix-strength`). Fills its
 * nearest positioned ancestor. Callers choose behavior only: `interactive`
 * lights the squares under the pointer; `glisten` drifts two slow lights
 * across them.
 */
export function PixelMatrix({
  interactive = false,
  glisten = false,
  className = "",
}: {
  interactive?: boolean;
  glisten?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = ref.current;
    const surface = layer?.parentElement;
    if (!layer || !surface || typeof IntersectionObserver === "undefined") {
      return;
    }
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let frame = 0;
    let x = 0;
    let y = 0;
    const sync = () => {
      layer.dataset.running = String(
        glisten && visible && !document.hidden && !motion.matches,
      );
      if (motion.matches || document.hidden || !visible) {
        delete layer.dataset.hovered;
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    const move = (event: PointerEvent) => {
      if (motion.matches || !visible || event.pointerType === "touch") return;
      const bounds = surface.getBoundingClientRect();
      x = event.clientX - bounds.left;
      y = event.clientY - bounds.top;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        layer.style.setProperty("--pixel-x", `${x}px`);
        layer.style.setProperty("--pixel-y", `${y}px`);
        layer.dataset.hovered = "true";
      });
    };
    const leave = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      delete layer.dataset.hovered;
    };
    const observer = new IntersectionObserver((entries) => {
      visible = entries.at(-1)?.isIntersecting ?? false;
      sync();
    });
    observer.observe(surface);
    if (interactive) {
      surface.addEventListener("pointermove", move, { passive: true });
      surface.addEventListener("pointerleave", leave);
    }
    motion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerleave", leave);
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [interactive, glisten]);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-running="false"
      className={`${styles.matrix} ${className}`}
    >
      <div className={styles.field} />
      {glisten ? <div className={styles.glisten} /> : null}
      {interactive ? <div className={styles.pointer} /> : null}
    </div>
  );
}
