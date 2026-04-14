"use client";

import React, { useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useFrontendTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { useCoAgent } from "@copilotkit/react-core";
import { z } from "zod";
import {
  DemoErrorBoundary,
  SalesDashboard,
  useShowcaseHooks,
  type SalesTodo,
  INITIAL_SALES_TODOS,
} from "@copilotkit/showcase-shared";

type AgentState = {
  todos: SalesTodo[];
};

export default function AgenticChatDemo() {
  return (
    <DemoErrorBoundary demoName="Agentic Chat">
      <CopilotKit runtimeUrl="/api/copilotkit" agent="my_agent">
        <DemoContent />
      </CopilotKit>
    </DemoErrorBoundary>
  );
}

function DemoContent() {
  const [themeColor, setThemeColor] = useState("#6366f1");

  const { state, setState } = useCoAgent<AgentState>({
    name: "my_agent",
    initialState: {
      todos: INITIAL_SALES_TODOS,
    },
  });

  useShowcaseHooks();

  useFrontendTool({
    name: "setThemeColor",
    description:
      "Set the theme color of the application. Call this when the user asks to change the color or theme.",
    parameters: z.object({
      themeColor: z
        .string()
        .describe("The theme color to set. Make sure to pick nice colors."),
    }),
    handler: async ({ themeColor }: { themeColor: string }) => {
      setThemeColor(themeColor);
      return { status: "success", message: `Theme color set to ${themeColor}` };
    },
  });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Add a deal",
        message: "Add a new $80,000 deal with TechCorp in the proposal stage.",
      },
      {
        title: "Pipeline status",
        message: "What's the current state of the sales pipeline?",
      },
      {
        title: "Update deal",
        message: "Move the Acme Corp deal to the negotiation stage.",
      },
      { title: "Change theme", message: "Set the theme to green." },
    ],
    available: "always",
  });

  return (
    <div
      className="flex h-screen w-full transition-colors duration-300"
      style={{ background: themeColor }}
    >
      {/* Sales Dashboard sidebar */}
      <div className="flex flex-col w-80 shrink-0 bg-white/10 backdrop-blur-sm overflow-y-auto">
        <SalesDashboard agentId="my_agent" />
      </div>

      {/* Chat */}
      <div className="flex-1 flex justify-center items-center p-6">
        <div className="h-full w-full max-w-2xl">
          <CopilotChat
            agentId="my_agent"
            className="h-full rounded-2xl max-w-6xl mx-auto"
          />
        </div>
      </div>
    </div>
  );
}
