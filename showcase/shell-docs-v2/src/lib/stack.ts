// The two axes a reader's stack varies on, and what the docs cover for each
// pair. Frontends come from showcase/shared/frontend-registry.json and
// backends from showcase/integrations/*/manifest.yaml (names, language,
// category).
//
// PROTOTYPE: `coverageFor` is sample data. React is "tested" because every
// showcase integration ships a React app with e2e coverage; the other states
// are illustrative until this reads the real registry.

export type FrontendId =
  "react" | "vue" | "react-native" | "angular" | "slack" | "teams";

export interface Frontend {
  id: FrontendId;
  name: string;
  group: "Web" | "Mobile" | "Channels";
  /** From frontend-registry.json. */
  summary: string;
}

export const FRONTENDS: readonly Frontend[] = [
  {
    id: "react",
    name: "React",
    group: "Web",
    summary: "The complete CopilotKit docs experience.",
  },
  {
    id: "vue",
    name: "Vue",
    group: "Web",
    summary: "Vue 3 provider, composables, and chat primitives.",
  },
  {
    id: "angular",
    name: "Angular",
    group: "Web",
    summary: "Angular components, directives, and services.",
  },
  {
    id: "react-native",
    name: "React Native",
    group: "Mobile",
    summary: "Mobile bindings for React Native and Expo apps.",
  },
  {
    id: "slack",
    name: "Slack",
    group: "Channels",
    summary: "Managed Slack channel through CopilotKit Intelligence.",
  },
  {
    id: "teams",
    name: "Teams",
    group: "Channels",
    summary: "Managed Teams channel through CopilotKit Intelligence.",
  },
];

export const FRONTEND_GROUPS: readonly Frontend["group"][] = [
  "Web",
  "Mobile",
  "Channels",
];

export type Language = "TypeScript" | "Python" | ".NET" | "Java";

export interface Backend {
  id: string;
  name: string;
  language: Language;
  popular?: boolean;
}

export const BACKENDS: readonly Backend[] = [
  {
    id: "built-in-agent",
    name: "CopilotKit",
    language: "TypeScript",
    popular: true,
  },
  { id: "mastra", name: "Mastra", language: "TypeScript", popular: true },
  {
    id: "langgraph-typescript",
    name: "LangGraph (TypeScript)",
    language: "TypeScript",
    popular: true,
  },
  {
    id: "claude-sdk-typescript",
    name: "Claude Agent SDK (TypeScript)",
    language: "TypeScript",
  },
  {
    id: "strands-typescript",
    name: "Strands Agents (TypeScript)",
    language: "TypeScript",
  },
  {
    id: "langgraph-python",
    name: "LangGraph (Python)",
    language: "Python",
    popular: true,
  },
  { id: "langgraph-fastapi", name: "LangGraph (FastAPI)", language: "Python" },
  {
    id: "crewai-crews",
    name: "CrewAI Flows",
    language: "Python",
    popular: true,
  },
  {
    id: "crewai-conversational-flows",
    name: "CrewAI Conversational Flows",
    language: "Python",
    popular: true,
  },
  { id: "pydantic-ai", name: "Pydantic AI", language: "Python" },
  { id: "google-adk", name: "Agent Development Kit (ADK)", language: "Python" },
  {
    id: "google-antigravity",
    name: "Google Antigravity SDK",
    language: "Python",
  },
  { id: "llamaindex", name: "LlamaIndex", language: "Python" },
  { id: "agno", name: "Agno", language: "Python" },
  { id: "ag2", name: "AG2", language: "Python" },
  { id: "strands", name: "Strands Agents (Python)", language: "Python" },
  {
    id: "ms-agent-python",
    name: "Microsoft Agent Framework (Python)",
    language: "Python",
  },
  {
    id: "claude-sdk-python",
    name: "Claude Agent SDK (Python)",
    language: "Python",
  },
  { id: "langroid", name: "Langroid", language: "Python" },
  {
    id: "ms-agent-dotnet",
    name: "Microsoft Agent Framework (.NET)",
    language: ".NET",
  },
  {
    id: "ms-agent-harness-dotnet",
    name: "Agent Framework Harness (.NET)",
    language: ".NET",
  },
  { id: "spring-ai", name: "Spring AI", language: "Java" },
];

export const LANGUAGES: readonly Language[] = [
  "TypeScript",
  "Python",
  ".NET",
  "Java",
];

export type Coverage = "tested" | "guide" | "none";

export const COVERAGE_LABEL: Record<Coverage, string> = {
  tested: "Tested end to end",
  guide: "Guide",
  none: "Not covered yet",
};

export function coverageFor(frontend: FrontendId, backend: Backend): Coverage {
  if (frontend === "react") return "tested";
  const channel = frontend === "slack" || frontend === "teams";
  if (channel && (backend.language === ".NET" || backend.language === "Java")) {
    return "none";
  }
  return "guide";
}

export interface Stack {
  frontend: FrontendId;
  backend: string;
}

export function frontendById(id: string): Frontend | undefined {
  return FRONTENDS.find((f) => f.id === id);
}

export function backendById(id: string): Backend | undefined {
  return BACKENDS.find((b) => b.id === id);
}

export function isServable(stack: Stack): boolean {
  const backend = backendById(stack.backend);
  return (
    !!backend &&
    !!frontendById(stack.frontend) &&
    coverageFor(stack.frontend, backend) !== "none"
  );
}
