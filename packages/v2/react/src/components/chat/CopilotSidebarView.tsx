import React, { useEffect, useRef, useState } from "react";

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

  const headerElement = renderSlot(header, CopilotModalHeader, {});
  const toggleButtonElement = renderSlot(
    toggleButton,
    CopilotChatToggleButton,
    {},
  );

  return (
    <>
      {isSidebarOpen && (
        <style
          dangerouslySetInnerHTML={{
            __html: `
            @media (min-width: 768px) {
              body {
                margin-inline-end: ${widthToMargin(sidebarWidth)};
                transition: margin-inline-end ${SIDEBAR_TRANSITION_MS}ms ease;
              }
            }`,
          }}
        />
      )}
      {toggleButtonElement}
      <aside
        ref={sidebarRef}
        data-copilot-sidebar
        className={cn(
          "fixed right-0 top-0 z-[1200] flex",
          // Height with dvh fallback and safe area support
          "h-[100vh] h-[100dvh] max-h-screen",
          // Responsive width: full on mobile, custom on desktop
          "w-full",
          "border-l border-border bg-background text-foreground shadow-xl",
          "transition-transform duration-300 ease-out",
          isSidebarOpen
            ? "translate-x-0"
            : "translate-x-full pointer-events-none",
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
        <div className="flex h-full w-full flex-col overflow-hidden">
          {headerElement}
          <div className="flex-1 overflow-hidden" data-sidebar-chat>
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
        <>
          {children({
            welcomeMessage: BoundWelcomeMessage,
            input,
            suggestionView,
            className,
            ...props,
          })}
        </>
      );
    }

    return (
      <div className={cn("h-full flex flex-col", className)} {...props}>
        {/* Welcome message - centered vertically */}
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          {BoundWelcomeMessage}
        </div>

        {/* Suggestions and input at bottom */}
        <div className="px-8 pb-4">
          <div className="max-w-3xl mx-auto">
            {/* Suggestions above input */}
            <div className="mb-4 flex justify-center">{suggestionView}</div>
            {input}
          </div>
        </div>
      </div>
    );
  };
}

export default CopilotSidebarView;
