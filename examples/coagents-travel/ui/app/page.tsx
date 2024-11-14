"use client";

import { MapCanvas } from "@/components/MapCanvas";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TripsProvider } from "@/lib/hooks/use-trips";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

export default function Home() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="travel_agent"
    >
      <CopilotSidebar
        defaultOpen
        clickOutsideToClose={false}
        labels={{
          title: "Travel Planner",
          initial: "Hi! 👋 I'm here to plan your trips. I can help you manage your trips, add places to them, or just generally work with you to plan a new one.",
        }}
      >
        <TooltipProvider>
          <TripsProvider>
            <main className="h-screen w-screen">
              <MapCanvas />
            </main>
          </TripsProvider>
        </TooltipProvider>
      </CopilotSidebar>
    </CopilotKit>
  );
}
