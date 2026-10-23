"use client";

import dynamic from "next/dynamic";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TripsProvider } from "@/lib/hooks/use-trips";
import {
  CopilotChatConfigurationProvider,
  CopilotKit,
  CopilotSidebar,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { useEffect } from "react";
import type { CSSProperties } from "react";
import { useMediaQuery } from "@/lib/hooks/use-media-query";

// Disable server-side rendering for the MapCanvas component, this
// is because Leaflet is not compatible with server-side rendering
//
// https://github.com/PaulLeCam/react-leaflet/issues/45
let MapCanvas: any;
MapCanvas = dynamic(
  () =>
    import("@/components/MapCanvas").then((module: any) => module.MapCanvas),
  {
    ssr: false,
  },
);

function MainContent() {
  const setModalOpen = useCopilotChatConfiguration()?.setModalOpen;
  const isDesktop = useMediaQuery("(min-width: 900px)");

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const copilotOpenParam = urlParams.get("copilotOpen");
    if (copilotOpenParam !== null) {
      setModalOpen?.(copilotOpenParam === "true");
    } else {
      setModalOpen?.(isDesktop);
    }
  }, [setModalOpen, isDesktop]);

  return (
    <TooltipProvider>
      <TripsProvider>
        <main className="h-screen w-screen">
          <MapCanvas />
        </main>
      </TripsProvider>
    </TooltipProvider>
  );
}

export default function Home() {
  const publicApiKey = process.env.NEXT_PUBLIC_CPK_PUBLIC_API_KEY;

  return (
    <CopilotKit
      runtimeUrl={publicApiKey ? undefined : "/api/copilotkit"}
      publicApiKey={publicApiKey}
    >
      <CopilotChatConfigurationProvider
        agentId="travel"
        isModalDefaultOpen={false}
      >
        <MainContent />
        <CopilotSidebar
          defaultOpen={false}
          style={
            {
              "--primary": "#000000",
              "--primary-foreground": "#ffffff",
              "--ring": "#000000",
            } as CSSProperties
          }
          labels={{
            modalHeaderTitle: "Travel Planner",
            welcomeMessageText:
              "Hi! 👋 I'm here to plan your trips. I can help you manage your trips, add places to them, or just generally work with you to plan a new one.",
          }}
        />
      </CopilotChatConfigurationProvider>
    </CopilotKit>
  );
}
