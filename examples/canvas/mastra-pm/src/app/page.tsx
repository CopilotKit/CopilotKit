"use client";

import {
  useAgent,
  useFrontendTool,
  CopilotSidebar,
  CopilotChatConfigurationProvider,
} from "@copilotkit/react-core/v2";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { z } from "zod";
import { createInitialState, isEmptyState, readAgentState } from "@/lib/state";
import { ProjectContainer } from "./components/ProjectContainer";

/** Share one agent and conversation between the project board and chat. */
export default function CopilotKitPage() {
  return (
    <CopilotChatConfigurationProvider agentId="default">
      <ProjectManager />
    </CopilotChatConfigurationProvider>
  );
}

/** Render the board from validated agent state and register its browser tools. */
function ProjectManager() {
  const [themeColor, setThemeColor] = useState("#6366f1");
  const { agent } = useAgent();
  const state = readAgentState(agent.state);

  useEffect(() => {
    if (isEmptyState(agent.state)) agent.setState(createInitialState());
  }, [agent]);

  useFrontendTool({
    name: "setThemeColor",
    agentId: "default",
    description: "Change the project board's theme color.",
    parameters: z.object({
      themeColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .describe("A six-digit CSS hex color, such as #008000"),
    }),
    handler: async ({ themeColor: nextColor }) => {
      setThemeColor(nextColor);
      return `Changed the theme to ${nextColor}`;
    },
  });

  return (
    <main
      className="h-screen w-full"
      style={{ "--copilot-kit-primary-color": themeColor } as CSSProperties}
    >
      <div
        style={{ backgroundColor: themeColor }}
        className="h-screen flex justify-center items-center flex-col transition-colors duration-300 p-6"
      >
        <ProjectContainer state={state} />
      </div>
      <CopilotSidebar
        defaultOpen
        labels={{
          modalHeaderTitle: "Project Assistant",
          welcomeMessageText:
            "Hi! Ask me to plan tasks, update the board, or change the project theme.",
        }}
      />
    </main>
  );
}
