import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

import CopilotChatView, {
  CopilotChatViewProps,
  WelcomeScreenProps,
} from "./CopilotChatView";
import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "@/providers/CopilotChatConfigurationProvider";
import CopilotChatToggleButton from "./CopilotChatToggleButton";
import { cn } from "@/lib/utils";
import { CopilotModalHeader } from "./CopilotModalHeader";
import { renderSlot, SlotValue } from "@/lib/slots";

const DEFAULT_SIDEBAR_WIDTH = 480;
const SIDEBAR_TRANSITION_MS = 260;

export type CopilotSidebarViewProps = CopilotChatViewProps & {
  header?: SlotValue<typeof CopilotModalHeader>;
  toggleButton?: SlotValue<typeof CopilotChatToggleButton>;
  width?: number | string;
  defaultOpen?: boolean;
};

export function CopilotSidebarView({
  header,
  toggleButton,
  width,
  defaultOpen = true,
  ...props
}: CopilotSidebarViewProps) {
  return (
    <CopilotChatConfigurationProvider isModalDefaultOpen={defaultOpen}>
      <CopilotSidebarViewInternal
        header={header}
        toggleButton={toggleButton}
        width={width}
        {...props}
      />
    </CopilotChatConfigurationProvider>
  );
}

function CopilotSidebarViewInternal({
  header,
  toggleButton,
  width,
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

    if (isSidebarOpen) {
      if (hasMounted.current) {
        document.body.style.transition = `margin-inline-end ${SIDEBAR_TRANSITION_MS}ms ease`;
      }
      document.body.style.marginInlineEnd = widthToMargin(sidebarWidth);
    } else if (hasMounted.current) {
      document.body.style.transition = `margin-inline-end ${SIDEBAR_TRANSITION_MS}ms ease`;
      document.body.style.marginInlineEnd = "";
    }

    hasMounted.current = true;

    return () => {
      document.body.style.marginInlineEnd = "";
      document.body.style.transition = "";
    };
  }, [isSidebarOpen, sidebarWidth]);

  const headerElement = renderSlot(header, CopilotModalHeader, {});
  const toggleButtonElement = renderSlot(
    toggleButton,
    CopilotChatToggleButton,
    {},
  );

  return (
    <>
      {toggleButtonElement}
      <aside
        ref={sidebarRef}
        data-copilotkit
        data-testid="copilot-sidebar"
        data-copilot-sidebar
        className={cn(
          "cpk:fixed cpk:right-0 cpk:top-0 cpk:z-[1200] cpk:flex",
          // Height with dvh fallback and safe area support
          "cpk:h-[100vh] cpk:h-[100dvh] cpk:max-h-screen",
          // Responsive width: full on mobile, custom on desktop
          "cpk:w-full",
          "cpk:border-l cpk:border-border cpk:bg-background cpk:text-foreground cpk:shadow-xl",
          "cpk:transition-transform cpk:duration-300 cpk:ease-out",
          isSidebarOpen
            ? "cpk:translate-x-0"
            : "cpk:translate-x-full cpk:pointer-events-none",
        )}
        style={
          {
            // Use CSS custom property for responsive width
            ["--sidebar-width" as string]: widthToCss(sidebarWidth),
            // Safe area insets for iOS
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
          } as React.CSSProperties
        }
        aria-hidden={!isSidebarOpen}
        aria-label="Copilot chat sidebar"
        role="complementary"
      >
        <div className="cpk:flex cpk:h-full cpk:w-full cpk:flex-col cpk:overflow-hidden">
          {headerElement}
          <div className="cpk:flex-1 cpk:overflow-hidden" data-sidebar-chat>
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
        className={cn("cpk:h-full cpk:flex cpk:flex-col", className)}
        {...props}
      >
        {/* Welcome message - centered vertically */}
        <div className="cpk:flex-1 cpk:flex cpk:flex-col cpk:items-center cpk:justify-center cpk:px-4">
          {BoundWelcomeMessage}
        </div>

        {/* Suggestions and input at bottom */}
        <div className="cpk:px-8 cpk:pb-4">
          <div className="cpk:max-w-3xl cpk:mx-auto">
            {/* Suggestions above input */}
            <div className="cpk:mb-4 cpk:flex cpk:justify-center">
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
