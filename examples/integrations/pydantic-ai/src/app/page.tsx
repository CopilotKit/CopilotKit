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
  CopilotThreadsDrawer,
} from "@copilotkit/react-core/v2";
import { useEffect, useState } from "react";
import { z } from "zod";

import styles from "./page.module.css";

export default function CopilotKitPage() {
  const [themeColor, setThemeColor] = useState("#6366f1");

  // 🪁 Frontend Actions: https://docs.copilotkit.ai/pydantic-ai/frontend-actions
  useFrontendTool({
    name: "setThemeColor",
    parameters: z.object({
      themeColor: z
        .string()
        .describe("The theme color to set. Make sure to pick nice colors."),
    }),
    handler: async ({ themeColor }) => {
      setThemeColor(themeColor);
      return `Set theme color to ${themeColor}`;
    },
  });

  return (
    /*
      One UNCONTROLLED CopilotChatConfigurationProvider (no `threadId` prop) owns
      the active thread for the whole surface. The SDK <CopilotThreadsDrawer> drives it
      directly — selecting a row sets the active thread, "+ New" resets to a
      fresh thread — with no host thread-state. The proverbs/weather/moon content
      and the CopilotSidebar read the same active thread from the provider (the
      content's `useAgent()` falls back to it). A *controlled* provider would
      block "+ New" from resetting, so uncontrolled-inside-provider is required.
      `.threadsLayout` (globals.css) pins the light theme vars the drawer +
      sidebar inherit; the SDK drawer follows them by token inheritance.
    */
    <CopilotChatConfigurationProvider agentId="default">
      <div className={`${styles.layout} threadsLayout`}>
        {/* SDK threads drawer (replaces the hand-rolled fork). License-gated: the locked view's Upgrade CTA opens the Intelligence docs by default. */}
        <CopilotThreadsDrawer agentId="default" />
        <div className={styles.mainPanel}>
          <main
            style={
              {
                "--copilot-kit-primary-color": themeColor,
              } as CopilotKitCSSProperties
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
      </div>
    </CopilotChatConfigurationProvider>
  );
}

function YourMainContent({ themeColor }: { themeColor: string }) {
  // 🪁 Shared State: https://docs.copilotkit.ai/pydantic-ai/shared-state
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
