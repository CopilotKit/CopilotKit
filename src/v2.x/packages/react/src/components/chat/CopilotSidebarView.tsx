import React, { useEffect, useRef, useState } from "react";

import CopilotChatView, { CopilotChatViewProps } from "./CopilotChatView";
import { useCopilotChatConfiguration } from "@/providers/CopilotChatConfigurationProvider";
import CopilotChatToggleButton from "./CopilotChatToggleButton";
import { cn } from "@/lib/utils";
import { CopilotModalHeader } from "./CopilotModalHeader";
import { renderSlot, SlotValue } from "@/lib/slots";

const DEFAULT_SIDEBAR_WIDTH = 480;
const SIDEBAR_TRANSITION_MS = 260;

export type CopilotSidebarViewProps = CopilotChatViewProps & {
  header?: SlotValue<typeof CopilotModalHeader>;
  width?: number | string;
};

export function CopilotSidebarView({ header, width, ...props }: CopilotSidebarViewProps) {
  const configuration = useCopilotChatConfiguration();

  const isSidebarOpen = configuration?.isModalOpen ?? false;

  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number | string>(width ?? DEFAULT_SIDEBAR_WIDTH);

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
      <CopilotChatToggleButton />
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
          isSidebarOpen ? "translate-x-0" : "translate-x-full pointer-events-none",
        )}
        style={{
          // Use CSS custom property for responsive width
          ["--sidebar-width" as string]: widthToCss(sidebarWidth),
          // Safe area insets for iOS
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        } as React.CSSProperties}
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

export default CopilotSidebarView;
