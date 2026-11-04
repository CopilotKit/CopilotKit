import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

import type {
  CopilotChatViewProps,
  WelcomeScreenProps,
} from "./CopilotChatView";
import CopilotChatView from "./CopilotChatView";
import {
  CopilotChatDefaultLabels,
  ɵSIDEBAR_DEFAULT_WIDTH,
  ɵSIDEBAR_TRANSITION_MS,
  ɵcreateDockedSidebar,
  ɵdimensionToCss,
  ɵwatchElementWidth,
} from "@copilotkit/core";
import type { ɵDockedSidebar } from "@copilotkit/core";
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
    width ?? ɵSIDEBAR_DEFAULT_WIDTH,
  );

  useEffect(() => {
    // If width is explicitly provided, don't measure
    if (width !== undefined) {
      return;
    }
    const element = sidebarRef.current;
    if (!element) {
      return;
    }
    return ɵwatchElementWidth(element, setSidebarWidth);
  }, [width]);

  const widthCss = ɵdimensionToCss(sidebarWidth, ɵSIDEBAR_DEFAULT_WIDTH);

  // The page makes room on the docked edge (desktop only). Layout effects run
  // before paint, so defaultOpen={true} never shows a layout shift: the
  // margin is already there on the first frame.
  const dockRef = useRef<ɵDockedSidebar | null>(null);
  useLayoutEffect(() => {
    const dock = ɵcreateDockedSidebar(document, {
      transitionMs: ɵSIDEBAR_TRANSITION_MS,
    });
    dockRef.current = dock;
    return () => {
      dock.dispose();
      dockRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    dockRef.current?.set({
      open: isSidebarOpen,
      position,
      width: widthCss,
    });
  }, [isSidebarOpen, position, widthCss]);

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
            "--sidebar-width": widthCss,
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
