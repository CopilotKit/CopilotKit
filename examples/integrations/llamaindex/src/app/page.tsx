"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { WeatherCard } from "@/components/WeatherCard";

import {
  useAgent,
  useFrontendTool,
  CopilotChatConfigurationProvider,
  CopilotSidebar,
  CopilotThreadsDrawer,
} from "@copilotkit/react-core/v2";

import styles from "./page.module.css";

export default function CopilotKitPage() {
  const [themeColor, setThemeColor] = useState("#6366f1");

  // 🪁 Frontend Actions: https://docs.copilotkit.ai/guides/frontend-actions
  useFrontendTool({
    name: "change_theme_color",
    parameters: z.object({
      theme_color: z
        .string()
        .describe("The theme color to set. Make sure to pick nice colors."),
    }),
    handler: async ({ theme_color }) => {
      setThemeColor(theme_color);
      return `Changing background to ${theme_color}`;
    },
  });

  return (
    <CopilotChatConfigurationProvider agentId="default">
      <div className={`${styles.layout} threadsLayout`}>
        <CopilotThreadsDrawer agentId="default" />
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
              clickOutsideToClose={false}
              defaultOpen={true}
              labels={{
                modalHeaderTitle: "Popup Assistant",
                welcomeMessageText:
                  '👋 Hi, there! You\'re chatting with an agent. This agent comes with a few tools to get you started.\n\nFor example you can try:\n- **Frontend Tools**: "Set the theme to orange"\n- **Shared State**: "Write a proverb about AI"\n- **Generative UI**: "Get the weather in SF"\n\nAs you interact with the agent, you\'ll see the UI update in real-time to reflect the agent\'s **state**, **tool calls**, and **progress**.',
              }}
            />
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

  // 🪁 Frontend Actions: https://docs.copilotkit.ai/coagents/frontend-actions
  useFrontendTool(
    {
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
    },
    [state],
  );

  //🪁 Generative UI: https://docs.copilotkit.ai/coagents/generative-ui
  useFrontendTool(
    {
      name: "get_weather",
      description: "Get the weather for a given location.",
      available: false,
      parameters: z.object({
        location: z.string(),
      }),
      render: ({ args }) => {
        return <WeatherCard location={args.location} themeColor={themeColor} />;
      },
      followUp: false,
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
