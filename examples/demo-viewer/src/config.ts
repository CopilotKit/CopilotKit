import { DemoConfig } from "@/types/demo";
import filesJSON from "./files.json";
import { ComponentType } from "react";

// Define type for filesJSON for safety
type FilesJsonType = Record<string, { files: { name: string; content: string; path: string; language: string; type: string; }[] }>;

export const AGENT_TYPE = process.env.NEXT_PUBLIC_AGENT_TYPE || 'crewai';

// A helper method to creating a config
function createDemoConfig({
  id,
  name,
  description,
  tags,
}: Pick<DemoConfig, "id" | "name" | "description" | "tags">): DemoConfig {
  const files = (filesJSON as FilesJsonType)[id]?.files || [];
  const [framework, ...agentIdParts] = id.split('_');
  const agentId = agentIdParts.join('_');
  
  return {
    id,
    name,
    description,
    path: `agent/demo/${id}`,
    component: () =>
      import(`../agent/demo/${id}/page`).then((mod) => {
          if (!mod.default) {
              throw new Error(`Demo component for ${id} failed to load. Check export default in ${id}/page.tsx`);
          }
          return mod.default as ComponentType;
      }),
    defaultLLMProvider: "openai",
    tags,
    files,
  };
}

const config: DemoConfig[] = [
  createDemoConfig({
    id: "crewai_agentic_chat",
    name: "Agentic Chat (CrewAI)",
    description: "Chat with your Copilot and call frontend tools",
    tags: ["CrewAI", "Chat", "Tools", "Streaming"],
  }),
  createDemoConfig({
    id: "crewai_human_in_the_loop",
    name: "Human in the loop (CrewAI)",
    description:
      "Plan a task together and direct the Copilot to take the right steps",
    tags: ["CrewAI", "HITL", "Interactivity"],
  }),
  createDemoConfig({
    id: "crewai_agentic_generative_ui",
    name: "Agentic Generative UI (CrewAI)",
    description:
      "Assign a long running task to your Copilot and see how it performs!",
    tags: ["CrewAI", "Generative ui (agent)", "Long running task"],
  }),
  createDemoConfig({
    id: "crewai_tool_based_generative_ui",
    name: "Tool Based Generative UI (CrewAI)",
    description: "Haiku generator that uses tool based generative UI.",
    tags: ["CrewAI", "Generative ui (action)", "Tools"],
  }),
  createDemoConfig({
    id: "crewai_shared_state",
    name: "Shared State (CrewAI)",
    description: "A recipe Copilot which reads and updates collaboratively",
    tags: ["CrewAI", "Agent State", "Collaborating"],
  }),
  createDemoConfig({
    id: "crewai_predictive_state_updates",
    name: "Predictive State Updates (CrewAI)",
    description:
      "Use collaboration to edit a document in real time with your Copilot",
    tags: ["CrewAI", "State", "Streaming", "Tools"],
  }),
  createDemoConfig({
    id: "crewai_crew_enterprise",
    name: "Crew Enterprise (CrewAI)",
    description: "Build AI Agents with CopilotKit + CrewAI",
    tags: ["CrewAI", "Thought Streaming", "Human in the Loop"],
  }),
  // === Add LangGraph Demos ===
  createDemoConfig({
    id: "langgraph_agentic_chat",
    name: "Agentic Chat (LangGraph)",
    description: "Chat with your Copilot and call frontend tools",
    tags: ["LangGraph", "Chat", "Tools", "Streaming"],
  }),
  createDemoConfig({
    id: "langgraph_human_in_the_loop",
    name: "Human in the loop (LangGraph)",
    description:
      "Plan a task together and direct the Copilot to take the right steps",
    tags: ["LangGraph", "HITL", "Interactivity"],
  }),
  createDemoConfig({
    id: "langgraph_agentic_generative_ui",
    name: "Agentic Generative UI (LangGraph)",
    description:
      "Assign a long running task to your Copilot and see how it performs!",
    tags: ["LangGraph", "Generative ui (agent)", "Long running task"],
  }),
  createDemoConfig({
    id: "langgraph_tool_based_generative_ui",
    name: "Tool Based Generative UI (LangGraph)",
    description: "Haiku generator that uses tool based generative UI.",
    tags: ["LangGraph", "Generative ui (action)", "Tools"],
  }),
  createDemoConfig({
    id: "langgraph_shared_state",
    name: "Shared State (LangGraph)",
    description: "A recipe Copilot which reads and updates collaboratively",
    tags: ["LangGraph", "Agent State", "Collaborating"],
  }),
  createDemoConfig({
    id: "langgraph_predictive_state_updates",
    name: "Predictive State Updates (LangGraph)",
    description:
      "Use collaboration to edit a document in real time with your Copilot",
    tags: ["LangGraph", "State", "Streaming", "Tools"],
  }),
  // TODO: Re-enable after revisiting demo
  // createDemoConfig({
  //     id: 'multi_agent_flows',
  //     name: 'Multi Agent Flows',
  //     description: 'Chat capability with streaming!',
  //     tags: ['Generative ui (action)', 'Streaming'],
  // }),
];

export default config;
