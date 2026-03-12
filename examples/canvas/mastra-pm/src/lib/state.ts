import { z } from "zod";
import { UserSchema, TaskSchema } from "@/lib/types";

export const AgentStateSchema = z.object({
  projectName: z.string(),
  projectDescription: z.string(),
  users: z.array(UserSchema),
  tasks: z.array(TaskSchema),
});

export type AgentState = z.infer<typeof AgentStateSchema>;