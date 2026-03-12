import { generateRandomId } from "@/lib/utils";
import { AgentState } from "@/lib/types";

export const initialState: AgentState = {
  todos: [
    {
      id: generateRandomId(),
      title: "Learn CopilotKit",
      description: "Explore the amazing features of CopilotKit!",
      status: "done",
    },
    {
      id: generateRandomId(),
      title: "Build a todo app",
      description: "Create an AI-powered todo application",
      status: "in-progress",
    },
  ],
};