"use client";

import { ProverbsCard } from "@/components/proverbs";
import { WeatherCard } from "@/components/weather";
import { ThreadsDrawer } from "@/components/threads-drawer";
import { ThreadsPanelGate } from "@/components/threads-drawer/locked-state";
import { AgentState } from "@/lib/types";
import {
  useAgent,
  useConfigureSuggestions,
  useFrontendTool,
  CopilotSidebar,
  CopilotChatConfigurationProvider,
} from "@copilotkit/react-core/v2";
import React, { useEffect, useState } from "react";
import { z } from "zod";

import styles from "@/components/threads-drawer/threads-drawer.module.css";

// The agent key registered in the runtime route (`agents: { default: ... }`)
// and the id passed to `useAgent({ agentId: "default" })` below.
const AGENT_ID = "default";

export default function CopilotKitPage() {
  const [themeColor, setThemeColor] = useState("#6366f1");
  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  // 🪁 Frontend Actions: https://docs.copilotkit.ai/adk/frontend-actions
  useFrontendTool({
    name: "setThemeColor",
    parameters: z.object({
      themeColor: z
        .string()
        .describe("The theme color to set. Make sure to pick nice colors."),
    }),
    handler: async ({ themeColor }) => {
      setThemeColor(themeColor);
      return `Changing theme color to ${themeColor}`;
    },
  });

  // 🪁 Suggestions: https://docs.copilotkit.ai/adk/suggestions
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Generative UI",
        message: "Get the weather in San Francisco.",
      },
      {
        title: "Frontend Tools",
        message: "Set the theme to green.",
      },
      {
        title: "Write Agent State",
        message: "Add a proverb about AI.",
      },
      {
        title: "Update Agent State",
        message:
          "Please remove 1 random proverb from the list if there are any.",
      },
      {
        title: "Read Agent State",
        message: "What are the proverbs?",
      },
    ],
  });

  return (
    // Share the active threadId with the chat + agent. `useAgent()` and the
    // CopilotSidebar fall back to this provider's threadId when called without
    // an explicit one, so selecting a thread in the drawer drives the chat.
    <CopilotChatConfigurationProvider agentId={AGENT_ID} threadId={threadId}>
      <div className={styles.layout}>
        {/* In-flow left threads panel, themed to match adk's chat (see globals.css). */}
        <div className={`threads-theme ${styles.threadsThemeRoot}`}>
          <ThreadsPanelGate>
            <ThreadsDrawer
              agentId={AGENT_ID}
              threadId={threadId}
              onThreadChange={setThreadId}
            />
          </ThreadsPanelGate>
        </div>

        {/* adk's demo content, verbatim, in the main panel. */}
        <main
          className={styles.mainPanel}
          style={
            { "--copilot-kit-primary-color": themeColor } as React.CSSProperties
          }
        >
          <YourMainContent themeColor={themeColor} />
          <CopilotSidebar
            defaultOpen={true}
            labels={{
              modalHeaderTitle: "Popup Assistant",
              welcomeMessageText:
                "👋 Hi, there! You're chatting with an agent.",
            }}
          />
        </main>
      </div>
    </CopilotChatConfigurationProvider>
  );
}

function YourMainContent({ themeColor }: { themeColor: string }) {
  // 🪁 Shared State: https://docs.copilotkit.ai/adk/shared-state
  // V2: useAgent returns the agent; read agent.state and write via agent.setState.
  const { agent } = useAgent({ agentId: AGENT_ID });
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

  //🪁 Generative UI: https://docs.copilotkit.ai/adk/generative-ui
  useFrontendTool({
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
  });

  return (
    <div
      style={{ backgroundColor: themeColor }}
      className="h-screen flex justify-center items-center flex-col transition-colors duration-300"
    >
      <ProverbsCard state={state} setState={setState} />
    </div>
  );
}
