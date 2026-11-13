import { z } from "zod";
import { UserSchema, TaskSchema, tasks, users } from "./types";

export const AgentStateSchema = z.object({
  projectName: z.string(),
  projectDescription: z.string(),
  users: z.array(UserSchema),
  tasks: z.array(TaskSchema),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

/** Create independent starter data for a new conversation. */
export function createInitialState(): AgentState {
  return {
    projectName: "My Project",
    projectDescription:
      "This is your new project, you can change the name and description at any time.",
    users: users.map((user) => ({ ...user })),
    tasks: tasks.map((task) => ({ ...task })),
  };
}

/** Seed only a new, empty state; never replace a hydrated or partial board. */
export function isEmptyState(value: unknown): boolean {
  return (
    value == null ||
    (typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0)
  );
}

const StreamedStateSchema = z.object({
  projectName: z.string().catch("My Project"),
  projectDescription: z.string().catch(""),
  users: z.array(z.unknown()).catch([]),
  tasks: z.array(z.unknown()).catch([]),
});

/** Validate each streamed record so incomplete tool arguments cannot crash the board. */
export function readAgentState(value: unknown): AgentState {
  if (isEmptyState(value)) return createInitialState();
  const parsed = StreamedStateSchema.safeParse(value);
  if (!parsed.success)
    return {
      projectName: "My Project",
      projectDescription: "",
      users: [],
      tasks: [],
    };
  return {
    ...parsed.data,
    users: parsed.data.users.flatMap((user) => {
      const result = UserSchema.safeParse(user);
      return result.success ? [result.data] : [];
    }),
    tasks: parsed.data.tasks.flatMap((task) => {
      const result = TaskSchema.safeParse(task);
      return result.success ? [result.data] : [];
    }),
  };
}
