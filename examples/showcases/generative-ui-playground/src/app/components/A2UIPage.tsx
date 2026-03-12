"use client";

/**
 * A2UI Page Component
 *
 * Uses @copilotkitnext/react for A2A compatibility.
 * The A2AAgent from @ag-ui/a2a works with the v2 runtime API.
 */

import { CopilotKitProvider, CopilotSidebar, CopilotPopup } from "@copilotkitnext/react";
import { createA2UIMessageRenderer } from "@copilotkit/a2ui-renderer";
import { a2uiTheme } from "../theme";
import { useMediaQuery } from "@/hooks/use-media-query";

// Create A2UI renderer with custom theme - module level for stable reference
const A2UIRenderer = createA2UIMessageRenderer({ theme: a2uiTheme });
const activityRenderers = [A2UIRenderer];

interface A2UIPageProps {
  children: React.ReactNode;
}

export function A2UIPage({ children }: A2UIPageProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-a2ui"
      showDevConsole={false}
      renderActivityMessages={activityRenderers}
    >
      {isDesktop ? (
        // Desktop: Sidebar layout
        <>
          {children}
          <CopilotSidebar
            defaultOpen={true}
            labels={{
              modalHeaderTitle: "A2UI Assistant",
              chatInputPlaceholder: "Ask me to generate any UI - forms, lists, cards, and more!",
            }}
          />
        </>
      ) : (
        // Mobile: Popup layout
        <>
          {children}
          <CopilotPopup
            defaultOpen={false}
            labels={{
              modalHeaderTitle: "A2UI Assistant",
              chatInputPlaceholder: "Ask me to generate any UI - forms, lists, cards, and more!",
            }}
          />
        </>
      )}
    </CopilotKitProvider>
  );
}
