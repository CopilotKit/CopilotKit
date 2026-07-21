"use client";

import {
  useAgent,
  useConfigureSuggestions,
  useDefaultRenderTool,
  useFrontendTool,
  useRenderTool,
  CopilotSidebar,
  CopilotChatConfigurationProvider,
  CopilotThreadsDrawer,
} from "@copilotkit/react-core/v2";
import React, { useEffect, useState } from "react";
import { z } from "zod";
import { DefaultToolComponent } from "@/components/default-tool-ui";
import { WeatherCard } from "@/components/weather";

import styles from "./page.module.css";

// agno registers a single agent under the key "default" (see
// src/app/api/copilotkit/[[...slug]]/route.ts), so the threads drawer + chat
// config provider must address that same agent id.
const AGENT_ID = "default";

export default function CopilotKitPage() {
  const [themeColor, setThemeColor] = useState("#6366f1");

  // 🪁 Frontend Actions: https://docs.copilotkit.ai/guides/frontend-actions
  useFrontendTool({
    name: "set_theme_color",
    parameters: z.object({
      theme_color: z
        .string()
        .describe("The theme color to set. Make sure to pick nice colors."),
    }),
    handler: async ({ theme_color }) => {
      setThemeColor(theme_color);
      return `Changing theme color to ${theme_color}`;
    },
  });

  // 🪁 Suggestions: https://docs.copilotkit.ai/guides/suggestions
  useConfigureSuggestions({
    available: "always",
    suggestions: [
      {
        title: "Generative UI",
        message: "What's the weather in San Francisco?",
      },
      {
        title: "Frontend Tools",
        message: "Set the theme to green.",
      },
      {
        title: "Default Tool Rendering",
        message: "What's the latest price of Apple stock?",
      },
      {
        title: "Writing Agent State",
        message: "Add a proverb about AI.",
      },
    ],
  });

  return (
    /*
      One UNCONTROLLED CopilotChatConfigurationProvider (no `threadId` prop) owns
      the active thread for the whole surface. The SDK <CopilotThreadsDrawer> drives it
      directly — selecting a row sets the active thread, "+ New" resets to a
      fresh thread — with no host thread-state. The proverbs/weather content
      and the CopilotSidebar read the same active thread from the provider (the
      content's `useAgent()` falls back to it). A *controlled* provider would
      block "+ New" from resetting, so uncontrolled-inside-provider is required.
      `.threadsLayout` (globals.css) pins the light theme vars the drawer +
      sidebar inherit; the SDK drawer follows them by token inheritance.
    */
    <CopilotChatConfigurationProvider agentId={AGENT_ID}>
      <div className={`${styles.layout} threadsLayout`}>
        {/* SDK threads drawer for the selected managed Intelligence project. */}
        <CopilotThreadsDrawer agentId={AGENT_ID} />
        <div className={styles.mainPanel}>
          <main
            style={
              {
                "--copilot-kit-primary-color": themeColor,
              } as React.CSSProperties
            }
          >
            <YourMainContent themeColor={themeColor} />
            <CopilotSidebar
              defaultOpen={true}
              // Adds an initial message to the chat
              labels={{
                modalHeaderTitle: "Popup Assistant",
                welcomeMessageText:
                  "👋 Hi, there! You're chatting with an Agno agent.",
              }}
            />
            {/* CopilotSidebar self-docks; main content renders as a sibling. */}
          </main>
        </div>
      </div>
    </CopilotChatConfigurationProvider>
  );
}

// State of the agent, make sure this aligns with your agent's state.
type AgentState = {
  proverbs: string[];
};

function YourMainContent({ themeColor }: { themeColor: string }) {
  // 🪁 Shared State: https://docs.copilotkit.ai/coagents/shared-state
  // V2: useAgent returns the agent; read agent.state and write via agent.setState.
  const { agent } = useAgent({ agentId: "default" });
  const state = (agent.state as AgentState | undefined) ?? { proverbs: [] };
  const setState = (next: AgentState) => agent.setState(next);

  // Seed an initial proverb once (the V2 agent starts with empty state).
  useEffect(() => {
    if ((agent.state as AgentState | undefined)?.proverbs === undefined) {
      agent.setState({
        proverbs: [
          "CopilotKit may be new, but it's the best thing since sliced bread.",
        ],
      });
    }
  }, [agent]);

  // 🪁 Frontend Actions: https://docs.copilotkit.ai/agno/frontend-tools
  useFrontendTool({
    name: "add_proverb",
    parameters: z.object({
      proverb: z
        .string()
        .describe("The proverb to add. Make it witty, short and concise."),
    }),
    handler: async ({ proverb }) => {
      // Read agent.state at call time so rapid successive adds don't drop
      // earlier proverbs via a stale closure over `state`.
      agent.setState({
        proverbs: [
          ...((agent.state as AgentState | undefined)?.proverbs ?? []),
          proverb,
        ],
      });
      return `Added proverb: ${proverb}`;
    },
  });

  //🪁 Generative UI: https://docs.copilotkit.ai/agno/generative-ui/backend-tools
  useRenderTool(
    {
      name: "get_weather",
      parameters: z.object({
        location: z.string(),
      }),
      render: ({ parameters }) => (
        <WeatherCard themeColor={themeColor} location={parameters.location} />
      ),
    },
    [themeColor],
  );

  //🪁 Default Generative UI: https://docs.copilotkit.ai/agno/generative-ui/backend-tools
  useDefaultRenderTool(
    {
      render: (props) => (
        <DefaultToolComponent themeColor={themeColor} {...props} />
      ),
    },
    [themeColor],
  );

  return (
    <div
      style={{ backgroundColor: themeColor }}
      className="h-screen flex justify-center items-center flex-col transition-colors duration-300"
    >
      <div className="bg-white/20 backdrop-blur-md p-8 rounded-2xl shadow-xl max-w-2xl w-full">
        <h1 className="text-4xl font-bold text-white mb-2 text-center">
          Proverbs
        </h1>
        <p className="text-gray-200 text-center italic mb-6">
          This is a demonstrative page, but it could be anything you want! 🪁
        </p>
        <hr className="border-white/20 my-6" />
        <div className="flex flex-col gap-3">
          {state.proverbs?.map((proverb, index) => (
            <div
              key={index}
              className="bg-white/15 p-4 rounded-xl text-white relative group hover:bg-white/20 transition-all"
            >
              <p className="pr-8">{proverb}</p>
              <button
                onClick={() =>
                  setState({
                    ...state,
                    proverbs: state.proverbs?.filter((_, i) => i !== index),
                  })
                }
                className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity
                  bg-red-500 hover:bg-red-600 text-white rounded-full h-6 w-6 flex items-center justify-center"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {state.proverbs?.length === 0 && (
          <p className="text-center text-white/80 italic my-8">
            No proverbs yet. Ask the assistant to add some!
          </p>
        )}
      </div>
    </div>
  );
}
