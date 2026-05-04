import * as React from "react";

interface Props {
  /**
   * The CSS custom property to drive (set on `document.documentElement`).
   * The corresponding grid column / panel width must reference this var
   * via `var(--name, fallback)`.
   */
  cssVar: string;
  /**
   * Which edge of the panel the handle sits on. `"left"` — dragging the
   * handle right shrinks the panel (the panel is anchored to the right
   * side of the screen, like a sidebar on the right). `"right"` — the
   * mirror case for left-anchored panels.
   */
  side: "left" | "right";
  /** Min/max width clamp, in CSS pixels. */
  min: number;
  max: number;
  /** Width to start from when no value has been persisted yet. */
  defaultPx: number;
  /** localStorage key used to persist the user's chosen width. */
  storageKey: string;
  /**
   * Override the handle's CSS class. Defaults to the generic
   * `.playground-resize-handle` (left-anchored variant). The left
   * sidebar's handle uses `.playground-sidebar-resize` to flip the
   * positioning to the right edge of its panel.
   */
  className?: string;
}

/**
 * Vertical splitter that resizes a sibling panel by writing a CSS custom
 * property on `document.documentElement`. Stateful only inside the drag —
 * the source of truth is the CSS variable + localStorage, not React
 * state, so the panel doesn't re-render every pixel of the drag.
 */
export function ResizeHandle({
  cssVar,
  side,
  min,
  max,
  defaultPx,
  storageKey,
  className = "playground-resize-handle",
}: Props): React.JSX.Element {
  // Restore the user's last width on mount.
  React.useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      const px = parseInt(stored, 10);
      if (Number.isFinite(px) && px >= min && px <= max) {
        document.documentElement.style.setProperty(cssVar, px + "px");
      }
    }
  }, [cssVar, storageKey, min, max]);

  const handleRef = React.useRef<HTMLDivElement | null>(null);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const root = document.documentElement;
      const startX = e.clientX;
      const computedRaw = getComputedStyle(root)
        .getPropertyValue(cssVar)
        .trim();
      const computed = parseInt(computedRaw, 10);
      const startWidth = Number.isFinite(computed) ? computed : defaultPx;

      handleRef.current?.classList.add("is-dragging");
      const prevBodyCursor = document.body.style.cursor;
      document.body.style.cursor = "col-resize";

      function onMove(ev: PointerEvent): void {
        const dx = ev.clientX - startX;
        // Right-anchored panel: drag right = shrink, drag left = grow.
        // Left-anchored panel: opposite.
        const next = side === "left" ? startWidth - dx : startWidth + dx;
        const clamped = Math.max(min, Math.min(max, next));
        root.style.setProperty(cssVar, clamped + "px");
      }
      function onUp(): void {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        handleRef.current?.classList.remove("is-dragging");
        document.body.style.cursor = prevBodyCursor;
        const finalRaw = getComputedStyle(root).getPropertyValue(cssVar).trim();
        const finalPx = parseInt(finalRaw, 10);
        if (Number.isFinite(finalPx)) {
          window.localStorage.setItem(storageKey, String(finalPx));
        }
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [cssVar, side, min, max, defaultPx, storageKey],
  );

  return (
    <div
      ref={handleRef}
      className={className}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      onPointerDown={onPointerDown}
    />
  );
}
