// TODO(copilotkit-2.0): `useCopilotReadable` was removed in 2.0. Use `useAgentContext` from "@copilotkit/react-core" instead. Its API is different: https://docs.copilotkit.ai/reference/v2/hooks/useAgentContext
// TODO(copilotkit-2.0): `useCopilotReadable`: V2 models readable application state as agent context.
import { useCopilotReadable, useAgentContext } from "@copilotkit/react-core";

interface Task {
  title: string;
  note?: string;
}

export function Board({ tasks, user }: { tasks: Task[]; user: string }) {
  useAgentContext({ description: "The tasks on the board", value: tasks });
  useAgentContext(
    {
      description: "The signed-in user",
      value: user,
    },
  );
  useAgentContext({
    description: "Task titles",
    value: (((_description, value) => value.map((t: Task) => t.title).join(", ")) as (description: string, value: any) => string)("Task titles", tasks),
  });

  // Left for the TODO: the id is used, and a disabled readable.
  const parentId = useCopilotReadable({ description: "Parent", value: 1 });
  useAgentContext({ description: "Child", value: 2 });
  useCopilotReadable({ description: "Hidden", value: 3, available: "disabled" });
  return null;
}
