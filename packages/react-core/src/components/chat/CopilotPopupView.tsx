import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  CopilotChatViewProps,
  WelcomeScreenProps,
} from "./CopilotChatView";
import CopilotChatView from "./CopilotChatView";
import CopilotChatToggleButton from "./CopilotChatToggleButton";
import { CopilotModalHeader } from "./CopilotModalHeader";
import type { CopilotModalHeaderProps } from "./CopilotModalHeader";
import { cn } from "../../lib/utils";
import type { SlotValue } from "../../lib/slots";
import { renderSlot } from "../../lib/slots";
import {
  CopilotChatDefaultLabels,
  ɵPOPUP_ANIMATION_MS,
  ɵbindPopupDismiss,
  ɵdimensionToCss,
} from "@copilotkit/core";
import {
  ControlledModalOpenScope,
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../../providers/CopilotChatConfigurationProvider";
import { useModalOpenControl } from "./modal-open-control";

const DEFAULT_POPUP_WIDTH = 420;
const DEFAULT_POPUP_HEIGHT = 560;

export type CopilotPopupViewProps = CopilotChatViewProps & {
  /** Accepts a className, partial props, or any component with CopilotModalHeader props — static namespace members are not required. */
  header?: SlotValue<React.ComponentType<CopilotModalHeaderProps>>;
  toggleButton?: SlotValue<typeof CopilotChatToggleButton>;
  width?: number | string;
  height?: number | string;
  clickOutsideToClose?: boolean;
  defaultOpen?: boolean;
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
  // Controlled open state supplied by `<CopilotPopup open onOpenChange>`.
  const { open, onOpenChange } = useModalOpenControl();
  // The scope is needed for either half: `open` pins the state, and
  // `onOpenChange` reports requests even while the popup manages itself.
  const hasOpenControl = open !== undefined || onOpenChange !== undefined;

  const internal = (
    <CopilotPopupViewInternal
      header={header}
      toggleButton={toggleButton}
      width={width}
      height={height}
      clickOutsideToClose={clickOutsideToClose}
      className={className}
      {...restProps}
    />
  );

  return (
    // Seed the underlying uncontrolled state from `open` so it starts aligned
    // with the host. The scope below is what the surface actually renders, so
    // this only matters if the host later drops `open` and hands control back:
    // the popup then stays where it was instead of jumping to `defaultOpen`.
    <CopilotChatConfigurationProvider isModalDefaultOpen={open ?? defaultOpen}>
      {hasOpenControl ? (
        <ControlledModalOpenScope open={open} onOpenChange={onOpenChange}>
          {internal}
        </ControlledModalOpenScope>
      ) : (
        internal
      )}
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
    }, ɵPOPUP_ANIMATION_MS);

    return () => clearTimeout(timeout);
  }, [isPopupOpen, isRendered]);

  // Escape, a click outside (when enabled), and focus once the popup opens.
  useEffect(() => {
    if (!isPopupOpen) {
      return;
    }
    return ɵbindPopupDismiss({
      getContainer: () => containerRef.current,
      onDismiss: () => setModalOpen?.(false),
      clickOutsideToClose: clickOutsideToClose === true,
    });
  }, [isPopupOpen, clickOutsideToClose, setModalOpen]);

  const headerElement = useMemo(
    () => renderSlot(header, CopilotModalHeader, {}),
    [header],
  );
  const toggleButtonElement = useMemo(
    () => renderSlot(toggleButton, CopilotChatToggleButton, {}),
    [toggleButton],
  );

  const resolvedWidth = ɵdimensionToCss(width, DEFAULT_POPUP_WIDTH);
  const resolvedHeight = ɵdimensionToCss(height, DEFAULT_POPUP_HEIGHT);

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

  const popupContent = isRendered ? (
    <div data-copilotkit className="cpk-popup-view">
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-label={labels.modalHeaderTitle}
        data-testid="copilot-popup"
        data-copilot-popup
        className={cn(
          "copilotKitPopup copilotKitWindow cpk-popup-view-window",
          isPopupOpen && !isAnimatingOut && "cpk-popup-view-window-open",
        )}
        style={popupStyle}
      >
        {headerElement}
        <div className="cpk-popup-view-chat" data-popup-chat>
          <CopilotChatView
            {...restProps}
            className={cn("cpk-popup-view-chat-view", className)}
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
        className={cn("cpk-popup-view-welcome-screen", className)}
        {...props}
      >
        {/* Welcome message - centered vertically */}
        <div className="cpk-popup-view-welcome-screen-message">
          {BoundWelcomeMessage}
        </div>

        {/* Suggestions and input at bottom */}
        <div>
          {/* Suggestions above input */}
          <div className="cpk-popup-view-welcome-screen-suggestions">
            {suggestionView}
          </div>
          {input}
        </div>
      </div>
    );
  };
}

export default CopilotPopupView;
