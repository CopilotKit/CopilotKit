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
    name: "Agentic Chat",
    description: "Chat with your Copilot and call frontend tools",
    tags: ["Chat", "Tools", "Streaming"],
  }),
  createDemoConfig({
    id: "crewai_human_in_the_loop",
    name: "Human in the loop",
    description:
      "Plan a task together and direct the Copilot to take the right steps",
    tags: ["HITL", "Interactivity"],
  }),
  createDemoConfig({
    id: "crewai_agentic_generative_ui",
    name: "Agentic Generative UI",
    description:
      "Assign a long running task to your Copilot and see how it performs!",
    tags: ["Generative ui (agent)", "Long running task"],
  }),
  createDemoConfig({
    id: "crewai_tool_based_generative_ui",
    name: "Tool Based Generative UI",
    description: "Haiku generator that uses tool based generative UI.",
    tags: ["Generative ui (action)", "Tools"],
  }),
  createDemoConfig({
    id: "crewai_shared_state",
    name: "Shared State",
    description: "A recipe Copilot which reads and updates collaboratively",
    tags: ["Agent State", "Collaborating"],
  }),
  createDemoConfig({
    id: "crewai_predictive_state_updates",
    name: "Predictive State Updates",
    description:
      "Use collaboration to edit a document in real time with your Copilot",
    tags: ["State", "Streaming", "Tools"],
  }),
  createDemoConfig({
    id: "crewai_crew_enterprise",
    name: "Crew Enterprise",
    description: "Build AI Agents with CopilotKit + CrewAI",
    tags: ["Thought Streaming", "Human in the Loop"],
  }),
  // === Add LangGraph Demos ===
  createDemoConfig({
    id: "langgraph_agentic_chat",
    name: "Agentic Chat",
    description: "Chat with your Copilot and call frontend tools",
    tags: ["Chat", "Tools", "Streaming"],
  }),
  createDemoConfig({
    id: "langgraph_human_in_the_loop",
    name: "Human in the loop",
    description:
      "Plan a task together and direct the Copilot to take the right steps",
    tags: ["HITL", "Interactivity"],
  }),
  createDemoConfig({
    id: "langgraph_agentic_generative_ui",
    name: "Agentic Generative UI",
    description:
      "Assign a long running task to your Copilot and see how it performs!",
    tags: ["Generative ui (agent)", "Long running task"],
  }),
  createDemoConfig({
    id: "langgraph_tool_based_generative_ui",
    name: "Tool Based Generative UI",
    description: "Haiku generator that uses tool based generative UI.",
    tags: ["Generative ui (action)", "Tools"],
  }),
  createDemoConfig({
    id: "langgraph_shared_state",
    name: "Shared State",
    description: "A recipe Copilot which reads and updates collaboratively",
    tags: ["Agent State", "Collaborating"],
  }),
  createDemoConfig({
    id: "langgraph_predictive_state_updates",
    name: "Predictive State Updates",
    description:
      "Use collaboration to edit a document in real time with your Copilot",
    tags: ["State", "Streaming", "Tools"],
  }),
  createDemoConfig({
    id: "langgraph_no_chat",
    name: "No Chat Example",
    description:
      "A Demo to demonstrate the CoAgents with no chat interface",
    tags: ["No Chat", "Agent State"],
  }),
  createDemoConfig({
    id: "standard_agentic_chat",
    name: "Agentic Chat",
    description: "Chat with your Copilot and call frontend tools",
    tags: ["Chat", "Tools", "Streaming"],
  }),
  createDemoConfig({
    id: "standard_human_in_the_loop",
    name: "Human in the loop",
    description:
      "Plan a task together and direct the Copilot to take the right steps",
    tags: ["HITL", "Interactivity"],
  }),
  createDemoConfig({
    id: "standard_agentic_generative_ui",
    name: "Agentic Generative UI",
    description:
      "Assign a long running task to your Copilot and see how it performs!",
    tags: ["Generative ui (agent)", "Long running task"],
  }),
  createDemoConfig({
    id: "standard_tool_based_generative_ui",
    name: "Tool Based Generative UI",
    description: "Haiku generator that uses tool based generative UI.",
    tags: ["Generative ui (action)", "Tools"],
  }),
  createDemoConfig({
    id: "standard_shared_state",
    name: "Shared State",
    description: "A recipe Copilot which reads and updates collaboratively",
    tags: ["Agent State", "Collaborating"],
  }),
  createDemoConfig({
    id: "standard_predictive_state_updates",
    name: "Predictive State Updates",
    description:
      "Use collaboration to edit a document in real time with your Copilot",
    tags: ["State", "Streaming", "Tools"],
  }),
  // TODO: Re-enable after revisiting demo
  // createDemoConfig({
  //     id: 'multi_agent_flows',
  //     name: 'Multi Agent Flows',
  //     description: 'Chat capability with streaming!',
  //     tags: ['Generative ui (action)', 'Streaming'],
  // }),
];

// Add the external Research Canvas demo
config.push({
  id: "research-canvas",
  name: "Coagents Research Canvas",
  description: "An external demo showcasing coagents in a research workflow.",
  path: "/research-canvas",
  files: [],
  iframeUrl: "https://examples-coagents-research-canvas-ui.vercel.app/",
  sourceCodeUrl: "https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-research-canvas",
  tags: ["Coagents", "Research", "External"],
});

export default config;
