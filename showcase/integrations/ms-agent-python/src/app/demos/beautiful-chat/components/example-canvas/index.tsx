"use client";

import { useAgent } from "@copilotkit/react-core/v2";
import { TodoList } from "./todo-list";

export function ExampleCanvas() {
  // Use the same agentId as the page's <CopilotKit agent="beautiful-chat">
  // wrapper. useAgent(undefined) resolves to a separate "default" agent
  // subscription whose state never receives the chat agent's STATE_SNAPSHOT,
  // even when the route.ts aliases both keys to the same HttpAgent instance.
  const { agent } = useAgent({ agentId: "beautiful-chat" });

  return (
    <div className="h-full overflow-y-auto bg-[--background]">
      <div className="max-w-4xl mx-auto px-8 py-10 h-full">
        <TodoList
          todos={agent.state?.todos || []}
          onUpdate={(updatedTodos) => agent.setState({ todos: updatedTodos })}
          isAgentRunning={agent.isRunning}
        />
      </div>
    </div>
  );
}
