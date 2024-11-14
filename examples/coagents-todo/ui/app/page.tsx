"use client";

import { TasksList } from "@/components/TasksList";
import { TasksProvider } from "@/lib/hooks/use-tasks";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

export default function Home() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="todo_manager_agent"
    >
      <CopilotSidebar
        labels={{
          title: "Todos Copilot",
          initial: "Hi! 👋 I'm here to help you get stuff done.",
        }}
        defaultOpen={true}
        clickOutsideToClose={false}
      >
        <TasksProvider>
          <TasksList />
        </TasksProvider>
      </CopilotSidebar>
    </CopilotKit>
  );
}
