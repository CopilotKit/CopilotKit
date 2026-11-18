import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { CopilotIcon } from "../icons/CopilotIcon";
import {
  CopilotChatDefaultLabels,
  ɵbindDialogFocus,
  ɵmorphViewTransition,
} from "@copilotkit/core";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";

interface LightboxProps {
  onClose: () => void;
  /** Accessible name of the dialog, for example the file name. */
  label?: string;
  children: React.ReactNode;
}

/**
 * A full-screen preview portalled to `document.body`. It closes on Escape, a
 * click on the backdrop, or its close button, which is named by
 * `labels.attachmentPreviewCloseButtonLabel`.
 *
 * It is a modal dialog for assistive technology: focus moves to the close
 * button when it opens, Tab stays inside it, and focus returns to the
 * element that opened it when it closes.
 */
export function Lightbox({ onClose, label, children }: LightboxProps) {
  const config = useCopilotChatConfiguration();
  const labels = config?.labels ?? CopilotChatDefaultLabels;
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return ɵbindDialogFocus(root);
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={rootRef}
      className="cpk-attachment-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <button
        type="button"
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

/**
 * Hook that manages lightbox open/close and uses the View Transition API to
 * morph the thumbnail into fullscreen content.
 *
 * `view-transition-name` must live on exactly ONE element at a time: on the
 * thumbnail before the change and on the lightbox content (bind `vtName`)
 * after it. `flushSync` commits the change inside the transition so the API
 * can snapshot old → new correctly.
 */
export function useLightbox() {
  const thumbnailRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const vtName = useId();

  const openLightbox = useCallback(() => {
    ɵmorphViewTransition(
      thumbnailRef.current,
      vtName,
      () => flushSync(() => setOpen(true)),
      "open",
    );
  }, [vtName]);

  const closeLightbox = useCallback(() => {
    ɵmorphViewTransition(
      thumbnailRef.current,
      vtName,
      () => flushSync(() => setOpen(false)),
      "close",
    );
  }, [vtName]);

  return {
    thumbnailRef,
    vtName,
    open,
    openLightbox,
    closeLightbox,
  };
}
