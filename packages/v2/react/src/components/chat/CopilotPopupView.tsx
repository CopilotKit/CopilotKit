import React, { useEffect, useMemo, useRef, useState } from "react";
import CopilotChatView, {
  CopilotChatViewProps,
  WelcomeScreenProps,
} from "./CopilotChatView";
import CopilotChatToggleButton from "./CopilotChatToggleButton";
import { CopilotModalHeader } from "./CopilotModalHeader";
import { cn } from "@/lib/utils";
import { renderSlot, SlotValue } from "@/lib/slots";
import {
  CopilotChatConfigurationProvider,
  CopilotChatDefaultLabels,
  useCopilotChatConfiguration,
} from "@/providers/CopilotChatConfigurationProvider";

const DEFAULT_POPUP_WIDTH = 420;
const DEFAULT_POPUP_HEIGHT = 560;

export type CopilotPopupViewProps = CopilotChatViewProps & {
  header?: SlotValue<typeof CopilotModalHeader>;
  toggleButton?: SlotValue<typeof CopilotChatToggleButton>;
  width?: number | string;
  height?: number | string;
  clickOutsideToClose?: boolean;
  defaultOpen?: boolean;
};

const dimensionToCss = (
  value: number | string | undefined,
  fallback: number,
): string => {
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
  toggleButton,
  width,
  height,
  clickOutsideToClose,
  defaultOpen = true,
  className,
  ...restProps
}: CopilotPopupViewProps) {
  return (
    <CopilotChatConfigurationProvider isModalDefaultOpen={defaultOpen}>
      <CopilotPopupViewInternal
        header={header}
        toggleButton={toggleButton}
        width={width}
        height={height}
        clickOutsideToClose={clickOutsideToClose}
        className={className}
        {...restProps}
      />
    </CopilotChatConfigurationProvider>
  );
}

function CopilotPopupViewInternal({
  header,
  toggleButton,
  width,
  height,
  clickOutsideToClose,
  className,
  ...restProps
}: Omit<CopilotPopupViewProps, "defaultOpen">) {
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
      const container = containerRef.current;
      // Don't steal focus if something inside the popup (like the input) is already focused
      if (container && !container.contains(document.activeElement)) {
        container.focus({ preventScroll: true });
      }
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

      const toggleButton = document.querySelector(
        "[data-slot='chat-toggle-button']",
      );
      if (toggleButton && toggleButton.contains(target)) {
        return;
      }

      setModalOpen?.(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isPopupOpen, clickOutsideToClose, setModalOpen]);

  const headerElement = useMemo(
    () => renderSlot(header, CopilotModalHeader, {}),
    [header],
  );
  const toggleButtonElement = useMemo(
    () => renderSlot(toggleButton, CopilotChatToggleButton, {}),
    [toggleButton],
  );

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
      ? "cpk:pointer-events-auto cpk:translate-y-0 cpk:opacity-100 cpk:md:scale-100"
      : "cpk:pointer-events-none cpk:translate-y-4 cpk:opacity-0 cpk:md:translate-y-5 cpk:md:scale-[0.95]";

  const popupContent = isRendered ? (
    <div
      data-copilotkit
      className={cn(
        "cpk:fixed cpk:inset-0 cpk:z-[1200] cpk:flex cpk:max-w-full cpk:flex-col cpk:items-stretch",
        "cpk:md:inset-auto cpk:md:bottom-24 cpk:md:right-6 cpk:md:items-end cpk:md:gap-4",
      )}
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-label={labels.modalHeaderTitle}
        data-testid="copilot-popup"
        data-copilot-popup
        className={cn(
          "cpk:relative cpk:flex cpk:h-full cpk:w-full cpk:flex-col cpk:overflow-hidden cpk:bg-background cpk:text-foreground",
          "cpk:origin-bottom cpk:focus:outline-none cpk:transform-gpu cpk:transition-transform cpk:transition-opacity cpk:duration-200 cpk:ease-out",
          "cpk:md:transition-transform cpk:md:transition-opacity",
          "cpk:rounded-none cpk:border cpk:border-border/0 cpk:shadow-none cpk:ring-0",
          "cpk:md:h-[var(--copilot-popup-height)] cpk:md:w-[var(--copilot-popup-width)]",
          "cpk:md:max-h-[var(--copilot-popup-max-height)] cpk:md:max-w-[var(--copilot-popup-max-width)]",
          "cpk:md:origin-bottom-right cpk:md:rounded-2xl cpk:md:border-border cpk:md:shadow-xl cpk:md:ring-1 cpk:md:ring-border/40",
          popupAnimationClass,
        )}
        style={popupStyle}
      >
        {headerElement}
        <div className="cpk:flex-1 cpk:overflow-hidden" data-popup-chat>
          <CopilotChatView
            {...restProps}
            className={cn("cpk:h-full cpk:min-h-0", className)}
          />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {toggleButtonElement}
      {popupContent}
    </>
  );
}

CopilotPopupView.displayName = "CopilotPopupView";

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CopilotPopupView {
  /**
   * Popup-specific welcome screen layout:
   * - Welcome message centered vertically
   * - Suggestions just above input
   * - Input fixed at the bottom
   */
  export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
    welcomeMessage,
    input,
    suggestionView,
    className,
    children,
    ...props
  }) => {
    // Render the welcomeMessage slot internally
    const BoundWelcomeMessage = renderSlot(
      welcomeMessage,
      CopilotChatView.WelcomeMessage,
      {},
    );

    if (children) {
      return (
        <div data-copilotkit style={{ display: "contents" }}>
          {children({
            welcomeMessage: BoundWelcomeMessage,
            input,
            suggestionView,
            className,
            ...props,
          })}
        </div>
      );
    }

    return (
      <div
        className={cn("cpk:h-full cpk:flex cpk:flex-col", className)}
        {...props}
      >
        {/* Welcome message - centered vertically */}
        <div className="cpk:flex-1 cpk:flex cpk:flex-col cpk:items-center cpk:justify-center cpk:px-4">
          {BoundWelcomeMessage}
        </div>

        {/* Suggestions and input at bottom */}
        <div>
          {/* Suggestions above input */}
          <div className="cpk:mb-4 cpk:flex cpk:justify-center cpk:px-4">
            {suggestionView}
          </div>
          {input}
        </div>
      </div>
    );
  };
}

export default CopilotPopupView;
