"use client";

import { TodoBoard } from "@/components/todo-board";
import { FullSendCard } from "@/components/full-send";
import { AgentState } from "@/lib/types";
import { CatchAllActionRenderProps, useCoAgent, useCopilotAction } from "@copilotkit/react-core";
import { CopilotKitCSSProperties, CopilotSidebar } from "@copilotkit/react-ui";
import { useState } from "react";
import { BackendToolsCard } from "@/components/backend-tools";
import { initialState } from "@/lib/defaults";

export default function Home() {
  const [themeColor, setThemeColor] = useState("#6366f1");

  /*
    🪁 Shared State with Agent
  */
  const { state, setState } = useCoAgent<AgentState>({
    name: "my_agent", // Must match the agent name in route.ts
    initialState
  });

  /*
    🪁 Frontend Action
  */
  useCopilotAction({
    name: "setThemeColor",
    parameters: [{ name: "themeColor", description: "The theme color to set.", required: true }],
    handler({ themeColor }) {
      setThemeColor(themeColor);
    },
  });

  /*
    🪁 Human in the Loop
  */
  useCopilotAction({
    name: "full_send",
    description: "Mark all todos as complete. Requires user confirmation.",
    renderAndWaitForResponse: (props) => (
      <FullSendCard themeColor={themeColor} {...props} state={state} setState={setState} />
    ),
  }, [themeColor, state, setState]);

  /*
    🪁 Backend Tools
  */
  useCopilotAction({
    name: "*",
    render: (props: CatchAllActionRenderProps) => (
      <BackendToolsCard themeColor={themeColor} {...props} />
    ),
  }, [themeColor]);

  return (
    <main style={{ "--copilot-kit-primary-color": themeColor } as CopilotKitCSSProperties}>
      {/* 
        🪁 Agent Chat UI
      */}
      <CopilotSidebar
        clickOutsideToClose={false}
        disableSystemMessage={true}
        labels={{
          title: "Todo Assistant",
          initial: "👋 Hi! I can help you manage your todos.",
        }}
        suggestions={[
          { title: "Add Todos", message: "Add a todo to build a website." },
          { title: "Change Theme", message: "Set the theme to a nice purple." },
          { title: "Update Status", message: "Move the first todo to in-progress." },
          { title: "Full Send", message: "Please full send it!" },
          { title: "Manage Tasks", message: "Delete all completed todos." },
          { title: "Read State", message: "What todos do I have?" },
        ]}
      >
        <div
          style={{ backgroundColor: themeColor }}
          className="h-screen w-full transition-colors duration-300"
        >
          <TodoBoard state={state} setState={setState} />
        </div>
      </CopilotSidebar>
    </main>
  );
}