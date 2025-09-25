"use client";
import "@copilotkit/react-ui/styles.css";
import React from "react";
import { CopilotChat } from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";

// Read environment variables for copilot configuration
const apiKey = process.env.NEXT_PUBLIC_COPILOT_API_KEY || "";
const agentName = process.env.NEXT_PUBLIC_COPILOTKIT_AGENT_NAME || "DefaultAgent";

/**
 * Layout component for the CopilotKit interface
 * 
 * This component creates a two-column layout:
 * 1. Left column (60%): Chat interface for user interaction
 * 2. Right column (40%): Results panel to display crew output
 * 
 * It configures CopilotKit with environment variables for API key and agent name
 * and provides optimized styling for both light and dark modes.
 */
export default function CoagentsCrewStarterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CopilotKit agent={agentName} publicApiKey={apiKey}>
      <div className="min-h-screen w-full bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
        <div className="flex flex-col md:flex-row w-full h-screen">
          {/* Chat Column */}
          <div className="w-full md:w-3/5 h-full overflow-y-auto border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <CopilotChat
              instructions="You are a helpful assistant that can help me with my tasks."
              className="h-full flex flex-col"
            />
          </div>

          {/* Results Column */}
          <div className="w-full md:w-2/5 h-full overflow-y-auto bg-zinc-50 dark:bg-zinc-950 p-4">
            <div className="rounded-lg shadow-sm bg-white dark:bg-zinc-900 h-full border border-zinc-100 dark:border-zinc-800 overflow-hidden">
              {children}
            </div>
          </div>
        </div>
      </div>
    </CopilotKit>
  );
}
