// The canvas is always visible alongside the chat pane (spec: "render chat plus a
// todo canvas in the same page shell"). It shows an empty state when there are no
// todos, and fills in as the agent or user adds items.
import { useAgent } from "@copilotkit/react-core/v2";
import { TodoList } from "./TodoList";
import type { Todo } from "./types";

export function TodoCanvas() {
  const { agent } = useAgent();

  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-neutral-950 [background-image:radial-gradient(circle,#d5d5d5_1px,transparent_1px)] dark:[background-image:radial-gradient(circle,#333_1px,transparent_1px)] [background-size:20px_20px]">
      <div className="max-w-4xl mx-auto px-8 py-10 h-full">
        <TodoList
          todos={(agent.state as { todos?: Todo[] })?.todos ?? []}
          onUpdate={(updatedTodos) => agent.setState({ todos: updatedTodos })}
          isAgentRunning={agent.isRunning}
        />
      </div>
    </div>
  );
}
