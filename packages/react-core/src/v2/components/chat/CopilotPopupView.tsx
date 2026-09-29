import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  CopilotChatViewProps,
  WelcomeScreenProps,
} from "./CopilotChatView";
import CopilotChatView from "./CopilotChatView";
import CopilotChatToggleButton from "./CopilotChatToggleButton";
import { CopilotModalHeader } from "./CopilotModalHeader";
import { cn } from "../../lib/utils";
import type { SlotValue } from "../../lib/slots";
import { renderSlot } from "../../lib/slots";
import {
  ControlledModalOpenScope,
  CopilotChatConfigurationProvider,
  CopilotChatDefaultLabels,
  ModalThreadsDrawerScope,
  useCopilotChatConfiguration,
} from "../../providers/CopilotChatConfigurationProvider";
import { useModalOpenControl } from "./modal-open-control";
import {
  ModalThreadsDrawer,
  hasModalThreadsDrawer,
} from "./modal-threads-drawer";
import type { ModalThreadsDrawerProp } from "./modal-threads-drawer";

const DEFAULT_POPUP_WIDTH = 420;
const DEFAULT_POPUP_HEIGHT = 560;

export type CopilotPopupViewProps = CopilotChatViewProps & {
  header?: SlotValue<typeof CopilotModalHeader>;
  toggleButton?: SlotValue<typeof CopilotChatToggleButton>;
  width?: number | string;
  height?: number | string;
  clickOutsideToClose?: boolean;
  defaultOpen?: boolean;
  /**
   * Adds a threads drawer to the popup. The header gets a thread-list launcher
   * (top-left) that slides the drawer in from the popup's left edge, over the
   * chat; Escape, the scrim, or picking a thread closes it, and picking a
   * thread or "New Thread" drives the chat. Defaults to off.
   *
   * `true` renders the default `CopilotThreadsDrawer`. Like other slots, a
   * class name or an object of its props configures it, and a component
   * replaces it. A replacement renders inside the popup's chat configuration:
   * `useCopilotChatConfiguration()` gives it `drawerOpen` / `setDrawerOpen`
   * and `setActiveThreadId` / `startNewThread`, and `useThreads()` lists the
   * threads. The header launcher shows for either. Threads need CopilotKit
   * Intelligence; without it the default drawer shows its upgrade prompt.
   *
   * A picked thread reaches the chat through a chat configuration above the
   * chat. `<CopilotPopup>` adds one. If you render this view yourself (for
   * example as a `chatView`), wrap the chat in a
   * `CopilotChatConfigurationProvider`.
   */
  threadsDrawer?: ModalThreadsDrawerProp;
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
  threadsDrawer,
  className,
  ...restProps
}: CopilotPopupViewProps) {
  // Controlled open state supplied by `<CopilotPopup open onOpenChange>`.
  const { open, onOpenChange } = useModalOpenControl();
  // The scope is needed for either half: `open` pins the state, and
  // `onOpenChange` reports requests even while the popup manages itself.
  const hasOpenControl = open !== undefined || onOpenChange !== undefined;

  const hasDrawer = hasModalThreadsDrawer(threadsDrawer);
  const internal = (
    <CopilotPopupViewInternal
      header={header}
      toggleButton={toggleButton}
      width={width}
      height={height}
      clickOutsideToClose={clickOutsideToClose}
      className={className}
      threadsDrawer={threadsDrawer}
      {...restProps}
    />
  );
  // The drawer's open state is local to this popup (see ModalThreadsDrawerScope).
  const surface = hasDrawer ? (
    <ModalThreadsDrawerScope>{internal}</ModalThreadsDrawerScope>
  ) : (
    internal
  );

  return (
    // Seed the underlying uncontrolled state from `open` so it starts aligned
    // with the host. The scope below is what the surface actually renders, so
    // this only matters if the host later drops `open` and hands control back:
    // the popup then stays where it was instead of jumping to `defaultOpen`.
    <CopilotChatConfigurationProvider isModalDefaultOpen={open ?? defaultOpen}>
      {hasOpenControl ? (
        <ControlledModalOpenScope open={open} onOpenChange={onOpenChange}>
          {surface}
        </ControlledModalOpenScope>
      ) : (
        surface
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
  threadsDrawer,
  ...restProps
}: Omit<CopilotPopupViewProps, "defaultOpen">) {
  const configuration = useCopilotChatConfiguration();
  const isPopupOpen = configuration?.isModalOpen ?? false;
  const setModalOpen = configuration?.setModalOpen;
  // An open in-popup drawer takes Escape first; the next Escape closes the popup.
  const drawerOverlayOpen =
    hasModalThreadsDrawer(threadsDrawer) &&
    (configuration?.drawerOpen ?? false);
  const setDrawerOpen = configuration?.setDrawerOpen;
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
        if (drawerOverlayOpen) {
          setDrawerOpen?.(false);
          return;
        }
        setModalOpen?.(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopupOpen, setModalOpen, drawerOverlayOpen, setDrawerOpen]);

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
          "copilotKitPopup copilotKitWindow",
          "cpk:relative cpk:flex cpk:h-full cpk:w-full cpk:flex-col cpk:overflow-hidden cpk:bg-background cpk:text-foreground",
          "cpk:origin-bottom cpk:focus:outline-none cpk:transform-gpu cpk:transition-transform cpk:transition-opacity cpk:duration-200 cpk:ease-out",
          "cpk:md:transition-transform cpk:md:transition-opacity",
          "cpk:rounded-none cpk:border cpk:border-border/0 cpk:shadow-none cpk:ring-0",
          "cpk:md:h-[var(--copilot-popup-height)] cpk:md:w-[var(--copilot-popup-width)]",
          "cpk:md:max-h-[var(--copilot-popup-max-height)] cpk:md:max-w-[var(--copilot-popup-max-width)]",
          "cpk:md:origin-bottom-right cpk:md:rounded-2xl cpk:md:border-border cpk:md:shadow-[0_2px_6px_-1px_rgb(0_0_0/0.06),0_24px_64px_-12px_rgb(0_0_0/0.22)]",
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
        {threadsDrawer !== undefined && threadsDrawer !== false && (
          <ModalThreadsDrawer threadsDrawer={threadsDrawer} />
        )}
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
   * Popup-specific welcome screen: the greeting, the suggestion cards
   * and the input, centered together.
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
        {/* Greeting, suggestions and input, centered together */}
        <div className="cpk:flex-1 cpk:flex cpk:flex-col cpk:items-center cpk:justify-center cpk:gap-5 cpk:px-4 cpk:py-6">
          <div className="cpk-intro">{BoundWelcomeMessage}</div>
          <div className="cpk-intro-stagger cpk:flex cpk:w-full cpk:justify-center cpk:empty:hidden">
            {suggestionView}
          </div>
          <div
            className="cpk-intro cpk:w-full"
            style={{ "--cpk-intro-delay": "180ms" } as React.CSSProperties}
          >
            {input}
          </div>
        </div>
      </div>
    );
  };
}

export default CopilotPopupView;
