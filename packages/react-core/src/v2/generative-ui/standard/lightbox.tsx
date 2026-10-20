import React, { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useOverlayEscape } from "./overlay-stack";
import { BACKDROP, ON_ACCENT, SHADOW_MD, radius } from "./tokens";

export interface LightboxImage {
  src: string;
  alt?: string;
}

const LIGHTBOX_BUTTON: CSSProperties = {
  position: "absolute",
  border: "none",
  borderRadius: 9999,
  background: "rgba(255,255,255,.15)",
  color: ON_ACCENT,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

/**
 * A full-screen view of one or more images. A click, Escape or the close
 * button closes it. With several images, the arrows and the arrow keys move
 * between them. Image, ImageGrid and CarouselMediaItem open it.
 */
export function Lightbox({
  images,
  index = 0,
  onClose,
}: {
  images: LightboxImage[];
  index?: number;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(index);
  const count = images.length;
  const step = (delta: number) =>
    setCurrent((i) => (count === 0 ? 0 : (i + delta + count) % count));
  // Escape goes through the overlay stack, so a lightbox inside a Modal
  // closes alone. The close is stable, so a re-render keeps the order.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback(() => closeRef.current(), []);
  useOverlayEscape(true, close);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" && count > 1) step(1);
      else if (event.key === "ArrowLeft" && count > 1) step(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count]);
  if (typeof document === "undefined") return null;
  const image = images[Math.min(current, count - 1)];
  if (!image) return null;
  const alt = image.alt ?? "";
  const arrow = (delta: -1 | 1) => (
    <button
      type="button"
      aria-label={delta < 0 ? "Previous image" : "Next image"}
      data-a2ui-lightbox-arrow={delta < 0 ? "prev" : "next"}
      onClick={(event) => {
        event.stopPropagation();
        step(delta);
      }}
      style={{
        ...LIGHTBOX_BUTTON,
        top: "50%",
        [delta < 0 ? "left" : "right"]: 16,
        transform: "translateY(-50%)",
        width: 44,
        height: 44,
        fontSize: 28,
        lineHeight: 1,
      }}
    >
      {delta < 0 ? "‹" : "›"}
    </button>
  );
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || "Image"}
      data-a2ui-lightbox=""
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: BACKDROP,
        cursor: "zoom-out",
      }}
    >
      <img
        key={image.src}
        src={image.src}
        alt={alt}
        style={{
          maxWidth: "min(92vw, 1400px)",
          maxHeight: "92vh",
          objectFit: "contain",
          borderRadius: radius("md"),
          boxShadow: SHADOW_MD,
        }}
      />
      {count > 1 ? (
        <span
          data-a2ui-lightbox-counter=""
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            color: ON_ACCENT,
            fontSize: 13,
            opacity: 0.8,
          }}
        >
          {current + 1} / {count}
        </span>
      ) : null}
      {count > 1 ? arrow(-1) : null}
      {count > 1 ? arrow(1) : null}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          ...LIGHTBOX_BUTTON,
          top: 16,
          right: 16,
          width: 36,
          height: 36,
          fontSize: 20,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>,
    document.body,
  );
}

/** Opens a URL in a new tab. An unsafe scheme (javascript:, data:) is ignored. */
export function openUrl(href: string | undefined) {
  if (!href || typeof window === "undefined") return;
  const trimmed = href.trim();
  if (!/^(https?:|mailto:)/i.test(trimmed)) return;
  window.open(trimmed, "_blank", "noopener,noreferrer");
}
