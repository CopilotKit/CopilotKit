import React, { useEffect, useMemo, useRef, useState } from "react";
import CopilotChatView, { CopilotChatViewProps } from "./CopilotChatView";
import CopilotChatToggleButton from "./CopilotChatToggleButton";
import { CopilotModalHeader } from "./CopilotModalHeader";
import { cn } from "@/lib/utils";
import { renderSlot, SlotValue } from "@/lib/slots";
import {
  CopilotChatDefaultLabels,
  useCopilotChatConfiguration,
} from "@/providers/CopilotChatConfigurationProvider";

const DEFAULT_POPUP_WIDTH = 420;
const DEFAULT_POPUP_HEIGHT = 560;

export type CopilotPopupViewProps = CopilotChatViewProps & {
  header?: SlotValue<typeof CopilotModalHeader>;
  width?: number | string;
  height?: number | string;
  clickOutsideToClose?: boolean;
};

const dimensionToCss = (value: number | string | undefined, fallback: number): string => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}px`;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  return `${fallback}px`;
};

export function CopilotPopupView({
  header,
  width,
  height,
  clickOutsideToClose,
  className,
  ...restProps
}: CopilotPopupViewProps) {
  const configuration = useCopilotChatConfiguration();
  const isPopupOpen = configuration?.isModalOpen ?? false;
  const setModalOpen = configuration?.setModalOpen;
  const labels = configuration?.labels ?? CopilotChatDefaultLabels;

  const containerRef = useRef<HTMLDivElement>(null);
  const [isRendered, setIsRendered] = useState(isPopupOpen);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  useEffect(() => {
    if (isPopupOpen) {
      setIsRendered(true);
      setIsAnimatingOut(false);
      return;
    }

    if (!isRendered) {
      return;
    }

    setIsAnimatingOut(true);
    const timeout = setTimeout(() => {
      setIsRendered(false);
      setIsAnimatingOut(false);
    }, 200);

    return () => clearTimeout(timeout);
  }, [isPopupOpen, isRendered]);

  useEffect(() => {
    if (!isPopupOpen) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setModalOpen?.(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopupOpen, setModalOpen]);

  useEffect(() => {
    if (!isPopupOpen) {
      return;
    }

    const focusTimer = setTimeout(() => {
      containerRef.current?.focus({ preventScroll: true });
    }, 200);

    return () => clearTimeout(focusTimer);
  }, [isPopupOpen]);

  useEffect(() => {
    if (!isPopupOpen || !clickOutsideToClose) {
      return;
    }

    if (typeof document === "undefined") {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      const container = containerRef.current;
      if (container?.contains(target)) {
        return;
      }

      const toggleButton = document.querySelector("[data-slot='chat-toggle-button']");
      if (toggleButton && toggleButton.contains(target)) {
        return;
      }

      setModalOpen?.(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isPopupOpen, clickOutsideToClose, setModalOpen]);

  const headerElement = useMemo(() => renderSlot(header, CopilotModalHeader, {}), [header]);

  const resolvedWidth = dimensionToCss(width, DEFAULT_POPUP_WIDTH);
  const resolvedHeight = dimensionToCss(height, DEFAULT_POPUP_HEIGHT);

  const popupStyle = useMemo(
    () =>
      ({
        "--copilot-popup-width": resolvedWidth,
        "--copilot-popup-height": resolvedHeight,
        "--copilot-popup-max-width": "calc(100vw - 3rem)",
        "--copilot-popup-max-height": "calc(100dvh - 7.5rem)",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }) as React.CSSProperties,
    [resolvedHeight, resolvedWidth],
  );

  const popupAnimationClass =
    isPopupOpen && !isAnimatingOut
      ? "pointer-events-auto translate-y-0 opacity-100 md:scale-100"
      : "pointer-events-none translate-y-4 opacity-0 md:translate-y-5 md:scale-[0.95]";

  const popupContent = isRendered ? (
    <div
      className={cn(
        "fixed inset-0 z-[1200] flex max-w-full flex-col items-stretch",
        "md:inset-auto md:bottom-24 md:right-6 md:items-end md:gap-4",
      )}
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-label={labels.modalHeaderTitle}
        data-copilot-popup
        className={cn(
          "relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground",
          "origin-bottom focus:outline-none transform-gpu transition-transform transition-opacity duration-200 ease-out",
          "md:transition-transform md:transition-opacity",
          "rounded-none border border-border/0 shadow-none ring-0",
          "md:h-[var(--copilot-popup-height)] md:w-[var(--copilot-popup-width)]",
          "md:max-h-[var(--copilot-popup-max-height)] md:max-w-[var(--copilot-popup-max-width)]",
          "md:origin-bottom-right md:rounded-2xl md:border-border md:shadow-xl md:ring-1 md:ring-border/40",
          popupAnimationClass,
        )}
        style={popupStyle}
      >
        {headerElement}
        <div className="flex-1 overflow-hidden" data-popup-chat>
          <CopilotChatView
            {...restProps}
            className={cn("h-full min-h-0", className)}
          />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <CopilotChatToggleButton />
      {popupContent}
    </>
  );
}

CopilotPopupView.displayName = "CopilotPopupView";

export default CopilotPopupView;
