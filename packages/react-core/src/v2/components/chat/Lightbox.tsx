import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { X } from "lucide-react";

interface LightboxProps {
  onClose: () => void;
  children: React.ReactNode;
}

export function Lightbox({ onClose, children }: LightboxProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="cpk:fixed cpk:inset-0 cpk:z-[9999] cpk:flex cpk:items-center cpk:justify-center cpk:bg-black/80 cpk:animate-fade-in"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="cpk:absolute cpk:top-4 cpk:right-4 cpk:text-white cpk:bg-white/10 cpk:hover:bg-white/20 cpk:rounded-full cpk:w-10 cpk:h-10 cpk:flex cpk:items-center cpk:justify-center cpk:cursor-pointer cpk:border-none cpk:z-10"
        aria-label="Close preview"
      >
        <X className="cpk:w-5 cpk:h-5" />
      </button>

      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body,
  );
}

type DocWithVT = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> };
};

/**
 * Hook that manages lightbox open/close and uses the View Transition API to
 * morph the thumbnail into fullscreen content.
 *
 * The trick: `view-transition-name` must live on exactly ONE element at a time.
 * - Old state (thumbnail visible): name is on the thumbnail.
 * - New state (lightbox visible): name moves to the lightbox content.
 * `flushSync` ensures React commits the DOM change synchronously inside the
 * `startViewTransition` callback so the API can snapshot old → new correctly.
 */
export function useLightbox() {
  const thumbnailRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const vtName = useId();

  const openLightbox = useCallback(() => {
    const thumb = thumbnailRef.current;
    const doc = document as DocWithVT;

    if (doc.startViewTransition && thumb) {
      thumb.style.viewTransitionName = vtName;

      doc.startViewTransition(() => {
        thumb.style.viewTransitionName = "";
        flushSync(() => setOpen(true));
      });
    } else {
      setOpen(true);
    }
  }, [vtName]);

  const closeLightbox = useCallback(() => {
    const thumb = thumbnailRef.current;
    const doc = document as DocWithVT;

    if (doc.startViewTransition && thumb) {
      const transition = doc.startViewTransition(() => {
        flushSync(() => setOpen(false));
        thumb.style.viewTransitionName = vtName;
      });
      transition.finished
        .then(() => {
          thumb.style.viewTransitionName = "";
        })
        .catch(() => {
          thumb.style.viewTransitionName = "";
        });
    } else {
      setOpen(false);
    }
  }, [vtName]);

  return {
    thumbnailRef,
    vtName,
    open,
    openLightbox,
    closeLightbox,
  };
}
