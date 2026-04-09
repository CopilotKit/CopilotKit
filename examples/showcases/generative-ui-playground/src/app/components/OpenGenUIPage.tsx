"use client";

/**
 * Open Generative UI Page Component
 *
 * Wraps children with a CopilotKitProvider configured for Open Generative UI.
 * Uses a dedicated API route with OpenGenerativeUIMiddleware enabled.
 */

import {
  CopilotKitProvider,
  CopilotSidebar,
  CopilotPopup,
} from "@copilotkitnext/react";
import { useMediaQuery } from "@/hooks/use-media-query";

interface OpenGenUIPageProps {
  children: React.ReactNode;
}

export function OpenGenUIPage({ children }: OpenGenUIPageProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-opengenui"
      showDevConsole={false}
    >
      {isDesktop ? (
        <>
          {children}
          <CopilotSidebar
            defaultOpen={true}
            labels={{
              modalHeaderTitle: "Open Generative UI",
              chatInputPlaceholder:
                "Ask me to build any UI — charts, apps, dashboards, and more!",
            }}
          />
        </>
      ) : (
        <>
          {children}
          <CopilotPopup
            defaultOpen={false}
            labels={{
              modalHeaderTitle: "Open Generative UI",
              chatInputPlaceholder:
                "Ask me to build any UI — charts, apps, dashboards, and more!",
            }}
          />
        </>
      )}
    </CopilotKitProvider>
  );
}
