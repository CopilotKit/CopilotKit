"use client";

/**
 * A2UI Page Component
 *
 * The A2A agent (from @ag-ui/a2a) writes A2UI surfaces. The runtime serves
 * them as generative UI surfaces, and the provider renders them with the
 * standard catalog.
 */

import {
  CopilotKitProvider,
  CopilotSidebar,
  CopilotPopup,
} from "@copilotkit/react-core";
import { standardUI } from "@copilotkit/react-core/generative-ui";
import { useMediaQuery } from "@/hooks/use-media-query";

// Module level for a stable reference
const generativeUI = { ui: standardUI };

interface A2UIPageProps {
  children: React.ReactNode;
}

export function A2UIPage({ children }: A2UIPageProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-a2ui"
      enableInspector={false}
      generativeUI={generativeUI}
    >
      {isDesktop ? (
        // Desktop: Sidebar layout
        <>
          {children}
          <CopilotSidebar
            defaultOpen={true}
            labels={{
              modalHeaderTitle: "A2UI Assistant",
              chatInputPlaceholder:
                "Ask me to generate any UI - forms, lists, cards, and more!",
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
              chatInputPlaceholder:
                "Ask me to generate any UI - forms, lists, cards, and more!",
            }}
          />
        </>
      )}
    </CopilotKitProvider>
  );
}
