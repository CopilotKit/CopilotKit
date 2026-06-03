"use client";

import { ProverbsCard } from "@/components/proverbs";
import { WeatherCard } from "@/components/weather";
import { MoonCard } from "@/components/moon";
import type { AgentState } from "@/lib/types";
import {
  useAgent,
  useFrontendTool,
  useHumanInTheLoop,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import type { CopilotKitCSSProperties } from "@copilotkit/react-core/v2";
import {
  CopilotChatConfigurationProvider,
  CopilotSidebar,
} from "@copilotkit/react-core/v2";
import { useEffect, useState } from "react";
import { z } from "zod";

import { ThreadsDrawer } from "@/components/threads-drawer";
import { ThreadsPanelGate } from "@/components/threads-drawer/locked-state";
import styles from "@/components/threads-drawer/threads-drawer.module.css";

export default function CopilotKitPage() {
  const [themeColor, setThemeColor] = useState("#6366f1");
  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  // 🪁 Frontend Actions: https://docs.copilotkit.ai/pydantic-ai/frontend-actions
  useFrontendTool({
    name: "setThemeColor",
    parameters: z.object({
      themeColor: z
        .string()
        .describe("The theme color to set. Make sure to pick nice colors."),
    }),
    handler({ themeColor: nextThemeColor }) {
      setThemeColor(nextThemeColor);
    },
  });

  return (
    <div className={`${styles.layout} threadsLayout`}>
      <ThreadsPanelGate>
        <ThreadsDrawer
          agentId="my_agent"
          threadId={threadId}
          onThreadChange={setThreadId}
        />
      </ThreadsPanelGate>
      <div className={styles.mainPanel}>
        <CopilotChatConfigurationProvider
          agentId="my_agent"
          threadId={threadId}
        >
          <main
            style={
              {
                "--copilot-kit-primary-color": themeColor,
              } as CopilotKitCSSProperties
            }
          >
            <YourMainContent themeColor={themeColor} />
            <CopilotSidebar
              disableSystemMessage={true}
              clickOutsideToClose={false}
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
                  title: "Human In the Loop",
                  message: "Please go to the moon.",
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
        </CopilotChatConfigurationProvider>
      </div>
    </div>
  );
}

function YourMainContent({ themeColor }: { themeColor: string }) {
  // 🪁 Shared State: https://docs.copilotkit.ai/pydantic-ai/shared-state
  const { agent } = useAgent({
    agentId: "my_agent",
  });
  const state = (agent.state as AgentState | undefined) ?? { proverbs: [] };
  const setState = (next: AgentState) => agent.setState(next);

  useEffect(() => {
    if ((agent.state as AgentState | undefined)?.proverbs === undefined) {
      agent.setState({
        proverbs: [
          "CopilotKit may be new, but it's the best thing since sliced bread.",
        ],
      });
    }
  }, [agent]);

  //🪁 Generative UI: https://docs.copilotkit.ai/pydantic-ai/generative-ui
  useRenderTool(
    {
      name: "get_weather",
      parameters: z.object({
        location: z.string(),
      }),
      render: ({ parameters }) => {
        return (
          <WeatherCard
            location={parameters.location ?? "the requested location"}
            themeColor={themeColor}
          />
        );
      },
    },
    [themeColor],
  );

  // 🪁 Human In the Loop: https://docs.copilotkit.ai/pydantic-ai/human-in-the-loop
  useHumanInTheLoop(
    {
      name: "go_to_moon",
      description: "Go to the moon on request.",
      render: ({ respond, status }) => {
        return (
          <MoonCard themeColor={themeColor} status={status} respond={respond} />
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
