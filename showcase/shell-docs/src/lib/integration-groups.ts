import type { LandingIntegration } from "./landing-integrations";

export const PRIORITY_GROUPS: Pick<
  LandingIntegration,
  "id" | "name" | "choices"
>[] = [
  {
    id: "copilotkit",
    name: "CopilotKit",
    choices: [{ slug: "built-in-agent", name: "CopilotKit" }],
  },
  {
    id: "deepagents",
    name: "DeepAgents",
    choices: [{ slug: "deepagents", name: "DeepAgents" }],
  },
  {
    id: "langchain",
    name: "LangChain",
    choices: [
      { slug: "langgraph-python", name: "Python" },
      { slug: "langgraph-typescript", name: "TypeScript" },
      {
        slug: "langgraph-fastapi",
        name: "Python with FastAPI",
        secondary: true,
      },
    ],
  },
  {
    id: "google-adk",
    name: "Google ADK",
    choices: [{ slug: "google-adk", name: "Google ADK" }],
  },
  {
    id: "strands",
    name: "AWS Strands",
    choices: [
      { slug: "strands", name: "Python" },
      { slug: "strands-typescript", name: "TypeScript" },
    ],
  },
  {
    id: "microsoft-agent-framework",
    name: "Microsoft Agent Framework",
    choices: [
      { slug: "ms-agent-python", name: "Python" },
      { slug: "ms-agent-dotnet", name: ".NET" },
    ],
  },
  {
    id: "mastra",
    name: "Mastra",
    choices: [{ slug: "mastra", name: "Mastra" }],
  },
];
