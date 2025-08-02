"use client";

import dynamic from "next/dynamic";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TripsProvider } from "@/lib/hooks/use-trips";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar, useChatContext } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { useEffect } from "react";
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
  }
);

function MainContent() {
  const { setOpen } = useChatContext();
  const isDesktop = useMediaQuery("(min-width: 900px)");
  
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const copilotOpenParam = urlParams.get('copilotOpen');
    if (copilotOpenParam !== null) {
      setOpen(copilotOpenParam === 'true');
    } else {
      setOpen(isDesktop);
    }
  }, [setOpen, isDesktop]);

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
  const lgcDeploymentUrl =
    globalThis.window === undefined
      ? null
      : new URL(window.location.href).searchParams.get("lgcDeploymentUrl");

  return (
    <CopilotKit
      agent="travel"
      runtimeUrl={
        process.env.NEXT_PUBLIC_CPK_PUBLIC_API_KEY == undefined
          ? `/api/copilotkit?lgcDeploymentUrl=${lgcDeploymentUrl ?? ""}`
          : "https://api.cloud.copilotkit.ai/copilotkit/v1"
      }
      publicApiKey={process.env.NEXT_PUBLIC_CPK_PUBLIC_API_KEY}
    >
      <CopilotSidebar
        defaultOpen={false}
        clickOutsideToClose={false}
        labels={{
          title: "Travel Planner",
          initial:
            "Hi! 👋 I'm here to plan your trips. I can help you manage your trips, add places to them, or just generally work with you to plan a new one.",
        }}
      >
        <MainContent />
      </CopilotSidebar>
    </CopilotKit>
  );
}
