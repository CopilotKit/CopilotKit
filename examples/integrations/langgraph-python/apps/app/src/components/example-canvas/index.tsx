"use client";

import { useAgent } from "@copilotkit/react-core/v2";
import { TodoList } from "./todo-list";

const layoutStyles = "h-full overflow-y-auto bg-white dark:bg-neutral-950 [background-image:radial-gradient(circle,#d5d5d5_1px,transparent_1px)] dark:[background-image:radial-gradient(circle,#333_1px,transparent_1px)] [background-size:20px_20px]"
const listStyles = "max-w-4xl mx-auto px-8 py-10 h-full"

export function ExampleCanvas() {
  const { agent } = useAgent();

  return (
    <div className={layoutStyles}>
      <div className={listStyles}>
        <TodoList
          todos={agent.state?.todos || []}
          onUpdate={(updatedTodos) => agent.setState({ todos: updatedTodos })}
          isAgentRunning={agent.isRunning}
        />
      </div>
    </div>
  );
}
