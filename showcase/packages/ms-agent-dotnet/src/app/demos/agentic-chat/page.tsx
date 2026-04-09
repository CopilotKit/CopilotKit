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
import { DemoErrorBoundary } from "../error-boundary";

type AgentState = {
  proverbs: string[];
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
      proverbs: [
        "CopilotKit may be new, but it's the best thing since sliced bread.",
      ],
    },
  });

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
      { title: "Add a proverb", message: "Add a proverb about AI." },
      { title: "Read state", message: "What are the proverbs?" },
      {
        title: "Update state",
        message: "Remove 1 random proverb from the list if there are any.",
      },
      { title: "Frontend tool", message: "Set the theme to green." },
    ],
    available: "always",
  });

  return (
    <div
      className="flex h-screen w-full transition-colors duration-300"
      style={{ background: themeColor }}
    >
      {/* Proverbs sidebar */}
      <div className="flex flex-col w-72 shrink-0 p-6 bg-white/10 backdrop-blur-sm overflow-y-auto">
        <h2 className="text-xl font-bold text-white mb-1">Proverbs</h2>
        <p className="text-white/70 text-xs italic mb-4">
          Managed by the agent via shared state
        </p>
        <div className="flex flex-col gap-2">
          {state.proverbs?.map((proverb, i) => (
            <div
              key={i}
              className="bg-white/15 p-3 rounded-xl text-white text-sm relative group hover:bg-white/20 transition-all"
            >
              <p className="pr-6">{proverb}</p>
              <button
                onClick={() =>
                  setState({
                    ...state,
                    proverbs: state.proverbs?.filter((_, j) => j !== i),
                  })
                }
                className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity
                                    bg-red-500 hover:bg-red-600 text-white rounded-full h-5 w-5 flex items-center justify-center text-xs"
              >
                x
              </button>
            </div>
          ))}
          {(!state.proverbs || state.proverbs.length === 0) && (
            <p className="text-white/60 italic text-sm">
              No proverbs yet. Ask the assistant to add some!
            </p>
          )}
        </div>
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
