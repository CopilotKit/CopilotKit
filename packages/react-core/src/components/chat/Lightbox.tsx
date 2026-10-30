import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { CopilotIcon } from "../icons/CopilotIcon";
import { CopilotChatDefaultLabels } from "@copilotkit/core";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";

interface LightboxProps {
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * A full-screen preview portalled to `document.body`. It closes on Escape, a
 * click on the backdrop, or its close button, which is named by
 * `labels.attachmentPreviewCloseButtonLabel`.
 */
export function Lightbox({ onClose, children }: LightboxProps) {
  const config = useCopilotChatConfiguration();
  const labels = config?.labels ?? CopilotChatDefaultLabels;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="cpk-attachment-lightbox" onClick={onClose}>
      <button
        onClick={onClose}
        className="cpk-attachment-lightbox-close-button"
        aria-label={labels.attachmentPreviewCloseButtonLabel}
      >
        <CopilotIcon name="X" className="cpk-attachment-lightbox-close-icon" />
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
