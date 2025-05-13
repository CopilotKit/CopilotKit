import { DemoConfig } from "@/types/demo";
import filesJSON from "./files.json";

// A helper method to creating a config
function createDemoConfig({
  id,
  name,
  description,
  tags,
}: Pick<DemoConfig, "id" | "name" | "description" | "tags">): DemoConfig {
  const files = (filesJSON as any)[id] ? (filesJSON as any)[id].files : [];
  return {
    id,
    name,
    description,
    path: `/feature/${id}`,
    defaultLLMProvider: "openai",
    tags,
    files,
  };
}

const config: DemoConfig[] = [
  createDemoConfig({
    id: "agentic_chat",
    name: "Agentic Chat",
    description: "Chat with your Copilot and call frontend tools",
    tags: ["Chat", "Tools", "Streaming"],
  }),
  createDemoConfig({
    id: "human_in_the_loop",
    name: "Human in the loop",
    description:
      "Plan a task together and direct the Copilot to take the right steps",
    tags: ["HITL", "Interactivity"],
  }),
];

export default config;
