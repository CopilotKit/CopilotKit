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
    id: "basic_chat",
    name: "Basic Chat",
    description: "Simple chat interface with weather tool",
    tags: ["Chat", "Tools", "Streaming"],
  }),
  createDemoConfig({
    id: "advanced_workflow",
    name: "Advanced Workflow",
    description: "Multi-step workflows with state management",
    tags: ["Workflows", "State Management", "Parallel Execution"],
  }),
  createDemoConfig({
    id: "multi_provider",
    name: "Multi-Provider",
    description: "Multiple AI providers with fallback strategies",
    tags: ["Providers", "Fallback", "Performance"],
  }),
  createDemoConfig({
    id: "real_time_collaboration",
    name: "Real-time Collaboration",
    description: "Collaborative features with shared state",
    tags: ["Collaboration", "Real-time", "Shared State"],
  }),
];

export default config;
