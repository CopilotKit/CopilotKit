"use client";

import { ProverbsCard } from "@/components/proverbs";
import { WeatherCard } from "@/components/weather";
import { ThreadsDrawer } from "@/components/threads-drawer";
import { ThreadsPanelGate } from "@/components/threads-drawer/locked-state";
import { AgentState } from "@/lib/types";
import {
  useAgent,
  useDefaultRenderTool,
  useFrontendTool,
  useHumanInTheLoop,
  useRenderTool,
  CopilotSidebar,
  CopilotChatConfigurationProvider,
} from "@copilotkit/react-core/v2";
import React, { useState } from "react";
import { z } from "zod";

import styles from "@/components/threads-drawer/threads-drawer.module.css";

// The agent key registered in the runtime route (`agents: { my_agent: ... }`)
// and the id passed to `useAgent({ agentId: "my_agent" })` below.
const AGENT_ID = "my_agent";

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
    handler({ themeColor }) {
      setThemeColor(themeColor);
    },
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
            suggestions={[
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
            ]}
          />
        </main>
      </div>
    </CopilotChatConfigurationProvider>
  );
}

function YourMainContent({ themeColor }: { themeColor: string }) {
  // 🪁 Shared State: https://docs.copilotkit.ai/adk/shared-state
  const { agent } = useAgent({
    agentId: AGENT_ID,
  });
  const state = (agent.state ?? {
    proverbs: [
      "CopilotKit may be new, but its the best thing since sliced bread.",
    ],
  }) as AgentState;
  const setState = (newState: AgentState) => agent.setState(newState);

  //🪁 Generative UI: https://docs.copilotkit.ai/adk/generative-ui
  useRenderTool(
    {
      name: "get_weather",
      render: ({ parameters, result }) => {
        return (
          <WeatherCard
            location={(parameters as any)?.location}
            themeColor={themeColor}
          />
        );
      },
    },
    [themeColor],
  );

  return (
    <div
      style={{ backgroundColor: themeColor }}
      className="h-screen flex justify-center items-center flex-col transition-colors duration-300"
    >
      <ProverbsCard state={state} setState={setState} />
    </div>
  );
}
