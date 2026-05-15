"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export const HOVER_DELAY_MS = 300;
export const DISMISS_DELAY_MS = 200;

let activeDismiss: (() => void) | null = null;

function registerActive(dismiss: () => void): void {
  if (activeDismiss && activeDismiss !== dismiss) {
    activeDismiss();
  }
  activeDismiss = dismiss;
}

function unregisterActive(dismiss: () => void): void {
  if (activeDismiss === dismiss) {
    activeDismiss = null;
  }
}

interface LinkPreviewProps {
  href: string;
  children: ReactNode;
}

export function LinkPreview({ href, children }: LinkPreviewProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<"below" | "above">("below");
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    setVisible(false);
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      dismiss();
      unregisterActive(dismiss);
    };
  }, [dismiss]);

  const cancelDismiss = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const startDismiss = useCallback(() => {
    cancelDismiss();
    dismissTimerRef.current = setTimeout(() => {
      setVisible(false);
      unregisterActive(dismiss);
    }, DISMISS_DELAY_MS);
  }, [cancelDismiss, dismiss]);

  const handleMouseEnter = useCallback(() => {
    cancelDismiss();
    if (window.matchMedia("(hover: none)").matches) return;
    hoverTimerRef.current = setTimeout(() => {
      if (wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        setPosition(spaceBelow < 300 ? "above" : "below");
      }
      registerActive(dismiss);
      setVisible(true);
    }, HOVER_DELAY_MS);
  }, [cancelDismiss, dismiss]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (visible) {
      startDismiss();
    }
  }, [visible, startDismiss]);

  const handlePopupMouseEnter = useCallback(() => {
    cancelDismiss();
  }, [cancelDismiss]);

  const handlePopupMouseLeave = useCallback(() => {
    startDismiss();
  }, [startDismiss]);

  const handleOverlayClick = useCallback(() => {
    window.open(href, "_blank", "noopener,noreferrer");
    dismiss();
    unregisterActive(dismiss);
  }, [href, dismiss]);

  function popupStyle(): React.CSSProperties {
    if (!wrapperRef.current) return {};
    const rect = wrapperRef.current.getBoundingClientRect();
    const left = rect.left + rect.width / 2 - 200;
    if (position === "above") {
      return {
        position: "fixed",
        left: Math.max(4, left),
        bottom: window.innerHeight - rect.top + 5,
        width: 400,
        height: 300,
      };
    }
    return {
      position: "fixed",
      left: Math.max(4, left),
      top: rect.bottom + 5,
      width: 400,
      height: 300,
    };
  }

  const portalTarget =
    typeof document !== "undefined"
      ? document.getElementById("link-preview-root")
      : null;

  return (
    <span
      ref={wrapperRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ display: "inline" }}
    >
      {children}
      {visible &&
        portalTarget &&
        createPortal(
          <div
            data-testid="link-preview-popup"
            data-position={position}
            onMouseEnter={handlePopupMouseEnter}
            onMouseLeave={handlePopupMouseLeave}
            className="rounded-lg border border-[var(--border)] shadow-lg overflow-hidden"
            style={{
              ...popupStyle(),
              zIndex: 100,
              backgroundColor: "var(--bg-surface)",
            }}
          >
            <iframe
              src={href}
              title="Link preview"
              style={{
                width: 1200,
                height: 900,
                border: "none",
                pointerEvents: "none",
                transform: "scale(0.333)",
                transformOrigin: "top left",
              }}
              sandbox="allow-scripts allow-same-origin"
              loading="lazy"
            />
            <div
              data-testid="link-preview-overlay"
              onClick={handleOverlayClick}
              style={{
                position: "absolute",
                inset: 0,
                cursor: "pointer",
              }}
            />
          </div>,
          portalTarget,
        )}
    </span>
  );
}
