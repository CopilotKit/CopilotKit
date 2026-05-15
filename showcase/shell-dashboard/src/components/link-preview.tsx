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
export const LOAD_TIMEOUT_MS = 8000;

type LoadState = "loading" | "loaded" | "unavailable";

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
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    setVisible(false);
    setLoadState("loading");
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  }, []);

  // Start the load timeout when popup becomes visible; reset when hidden
  useEffect(() => {
    if (visible) {
      loadTimeoutRef.current = setTimeout(() => {
        setLoadState((prev) => (prev === "loading" ? "unavailable" : prev));
      }, LOAD_TIMEOUT_MS);
    } else {
      setLoadState("loading");
    }
    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
    };
  }, [visible]);

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

  const handleIframeLoad = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    setLoadState("loaded");
  }, []);

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
              onLoad={handleIframeLoad}
              style={{
                width: 1200,
                height: 900,
                border: "none",
                pointerEvents: "none",
                transform: "scale(0.333)",
                transformOrigin: "top left",
                opacity: loadState === "loaded" ? 1 : 0,
                transition: "opacity 200ms ease-in",
              }}
              sandbox="allow-scripts allow-same-origin"
              loading="lazy"
            />
            {loadState === "loading" && (
              <div
                data-testid="link-preview-loading"
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    color: "var(--text-muted)",
                    fontSize: 13,
                    animation: "lp-pulse 1.5s ease-in-out infinite",
                  }}
                >
                  Loading preview&hellip;
                </span>
                <style>{`@keyframes lp-pulse { 0%,100% { opacity: .4 } 50% { opacity: 1 } }`}</style>
              </div>
            )}
            {loadState === "unavailable" && (
              <div
                data-testid="link-preview-unavailable"
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                }}
              >
                <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  Preview unavailable
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                  Click to visit &rarr;
                </span>
              </div>
            )}
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
