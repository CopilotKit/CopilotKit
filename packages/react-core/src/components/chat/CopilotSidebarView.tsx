import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

import type {
  CopilotChatViewProps,
  WelcomeScreenProps,
} from "./CopilotChatView";
import CopilotChatView from "./CopilotChatView";
import { CopilotChatDefaultLabels } from "@copilotkit/core";
import {
  ControlledModalOpenScope,
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../../providers/CopilotChatConfigurationProvider";
import { useModalOpenControl } from "./modal-open-control";
import CopilotChatToggleButton from "./CopilotChatToggleButton";
import { cn } from "../../lib/utils";
import { CopilotModalHeader } from "./CopilotModalHeader";
import type { CopilotModalHeaderProps } from "./CopilotModalHeader";
import type { SlotValue } from "../../lib/slots";
import { renderSlot } from "../../lib/slots";

const DEFAULT_SIDEBAR_WIDTH = 480;
const SIDEBAR_TRANSITION_MS = 260;

export type CopilotSidebarViewProps = CopilotChatViewProps & {
  /** Accepts a className, partial props, or any component with CopilotModalHeader props — static namespace members are not required. */
  header?: SlotValue<React.ComponentType<CopilotModalHeaderProps>>;
  toggleButton?: SlotValue<typeof CopilotChatToggleButton>;
  width?: number | string;
  defaultOpen?: boolean;
  position?: "left" | "right";
};

/**
 * The chat in a side panel: a `complementary` region named by
 * `labels.sidebarLabel`, with a header, the chat view and a toggle button.
 */
export function CopilotSidebarView({
  header,
  toggleButton,
  width,
  defaultOpen = true,
  position = "right",
  ...props
}: CopilotSidebarViewProps) {
  // Controlled open state supplied by `<CopilotSidebar open onOpenChange>`.
  const { open, onOpenChange } = useModalOpenControl();
  // The scope is needed for either half: `open` pins the state, and
  // `onOpenChange` reports requests even while the sidebar manages itself.
  const hasOpenControl = open !== undefined || onOpenChange !== undefined;

  const internal = (
    <CopilotSidebarViewInternal
      header={header}
      toggleButton={toggleButton}
      width={width}
      position={position}
      {...props}
    />
  );

  return (
    // Seed the underlying uncontrolled state from `open` so it starts aligned
    // with the host. The scope below is what the surface actually renders, so
    // this only matters if the host later drops `open` and hands control back:
    // the sidebar then stays where it was instead of jumping to `defaultOpen`.
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

function CopilotSidebarViewInternal({
  header,
  toggleButton,
  width,
  position = "right",
  ...props
}: Omit<CopilotSidebarViewProps, "defaultOpen">) {
  const configuration = useCopilotChatConfiguration();

  const isSidebarOpen = configuration?.isModalOpen ?? false;

  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number | string>(
    width ?? DEFAULT_SIDEBAR_WIDTH,
  );

  // Helper to convert width to CSS value
  const widthToCss = (w: number | string): string => {
    return typeof w === "number" ? `${w}px` : w;
  };

  // Helper to extract numeric value for body margin (only works with px values)
  const widthToMargin = (w: number | string): string => {
    if (typeof w === "number") {
      return `${w}px`;
    }
    // For string values, use as-is (assumes valid CSS unit)
    return w;
  };

  useEffect(() => {
    // If width is explicitly provided, don't measure
    if (width !== undefined) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const element = sidebarRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0) {
        setSidebarWidth(rect.width);
      }
    };

    updateWidth();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateWidth());
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [width]);

  // Manage body margin for sidebar docking (desktop only).
  // useLayoutEffect runs before paint, so defaultOpen={true} never causes a
  // visible layout shift — the margin is already applied on the first frame.
  const hasMounted = useRef(false);

  useLayoutEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;
    if (!window.matchMedia("(min-width: 768px)").matches) return;

    const marginStyleProp =
      position === "left" ? "marginInlineStart" : "marginInlineEnd";
    const transitionCssProp =
      position === "left" ? "margin-inline-start" : "margin-inline-end";

    if (isSidebarOpen) {
      if (hasMounted.current) {
        document.body.style.transition = `${transitionCssProp} ${SIDEBAR_TRANSITION_MS}ms ease`;
      }
      document.body.style[marginStyleProp] = widthToMargin(sidebarWidth);
    } else if (hasMounted.current) {
      document.body.style.transition = `${transitionCssProp} ${SIDEBAR_TRANSITION_MS}ms ease`;
      document.body.style[marginStyleProp] = "";
    }

    hasMounted.current = true;

    return () => {
      document.body.style[marginStyleProp] = "";
      document.body.style.transition = "";
    };
  }, [isSidebarOpen, sidebarWidth, position]);

  const headerElement = renderSlot(header, CopilotModalHeader, {});
  const toggleButtonElement = renderSlot(
    toggleButton,
    CopilotChatToggleButton,
    position === "left"
      ? { className: "cpk-sidebar-view-toggle-button-left" }
      : {},
  );

  return (
    <>
      {toggleButtonElement}
      <aside
        ref={sidebarRef}
        data-copilotkit
        data-testid="copilot-sidebar"
        data-copilot-sidebar
        data-position={position}
        className={cn(
          "copilotKitSidebar copilotKitWindow cpk-sidebar-view",
          // Slides off its edge (data-position) when closed.
          !isSidebarOpen && "cpk-sidebar-view-closed",
        )}
        style={
          {
            // Use CSS custom property for responsive width
            "--sidebar-width": widthToCss(sidebarWidth),
            // Safe area insets for iOS
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
          } as React.CSSProperties
        }
        aria-hidden={!isSidebarOpen}
        aria-label={
          configuration?.labels.sidebarLabel ??
          CopilotChatDefaultLabels.sidebarLabel
        }
        role="complementary"
      >
        <div className="cpk-sidebar-view-panel">
          {headerElement}
          <div className="cpk-sidebar-view-chat" data-sidebar-chat>
            <CopilotChatView {...props} />
          </div>
        </div>
      </aside>
    </>
  );
}

CopilotSidebarView.displayName = "CopilotSidebarView";

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CopilotSidebarView {
  /**
   * Sidebar-specific welcome screen layout:
   * - Suggestions at the top
   * - Welcome message in the middle
   * - Input fixed at the bottom (like normal chat)
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
        className={cn("cpk-sidebar-view-welcome-screen", className)}
        {...props}
      >
        {/* Welcome message - centered vertically */}
        <div className="cpk-sidebar-view-welcome-screen-message">
          {BoundWelcomeMessage}
        </div>

        {/* Suggestions and input at bottom */}
        <div className="cpk-sidebar-view-welcome-screen-footer">
          <div className="cpk-sidebar-view-welcome-screen-content">
            {/* Suggestions above input */}
            <div className="cpk-sidebar-view-welcome-screen-suggestions">
              {suggestionView}
            </div>
            {input}
          </div>
        </div>
      </div>
    );
  };
}

export default CopilotSidebarView;
