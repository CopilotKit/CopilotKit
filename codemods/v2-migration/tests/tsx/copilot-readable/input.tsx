import { useCopilotReadable } from "@copilotkit/react-core";

interface Task {
  title: string;
  note?: string;
}

export function Board({ tasks, user }: { tasks: Task[]; user: string }) {
  useCopilotReadable({ description: "The tasks on the board", value: tasks });
  useCopilotReadable(
    {
      description: "The signed-in user",
      value: user,
      categories: ["profile"],
      available: "enabled",
    },
    [user],
  );
  useCopilotReadable({
    description: "Task titles",
    value: tasks,
    convert: (_description, value) => value.map((t: Task) => t.title).join(", "),
  });

  // Left for the TODO: the id is used, and a disabled readable.
  const parentId = useCopilotReadable({ description: "Parent", value: 1 });
  useCopilotReadable({ description: "Child", value: 2, parentId });
  useCopilotReadable({ description: "Hidden", value: 3, available: "disabled" });
  return null;
}
