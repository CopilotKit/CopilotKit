// Sample data for the picker prototypes under /proto. Framework names and
// summaries follow each project's own site and README (checked Oct 27 2026). Framework names,
// languages, demo counts (the `features` list length) and capabilities come
// from showcase/integrations/*/manifest.yaml. Page content is illustrative.

export type FrontendId =
  "react" | "vue" | "angular" | "react-native" | "slack" | "teams";

export const FRONTENDS: {
  id: FrontendId;
  name: string;
  summary: string;
  /** Channels are the chat-platform SDKs (`@copilotkit/channels-*`). */
  kind: "app" | "channel";
}[] = [
  {
    id: "react",
    name: "React",
    summary: "Provider, hooks, and chat components.",
    kind: "app",
  },
  {
    id: "vue",
    name: "Vue",
    summary: "Vue 3 provider, composables, and chat primitives.",
    kind: "app",
  },
  {
    id: "angular",
    name: "Angular",
    summary: "Components, directives, and services.",
    kind: "app",
  },
  {
    id: "react-native",
    name: "React Native",
    summary: "Bindings for React Native and Expo apps.",
    kind: "app",
  },
  {
    id: "slack",
    name: "Slack",
    summary: "Run your agent as a Slack bot.",
    kind: "channel",
  },
  {
    id: "teams",
    name: "Teams",
    summary: "Run your agent as a Microsoft Teams bot.",
    kind: "channel",
  },
];

export const CAPABILITIES = [
  "Generative UI",
  "Human in the loop",
  "Shared state",
  "Interrupts",
  "Subagents",
  "A2UI",
  "Voice",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Grouping order wherever frameworks are listed by language. */
export const LANGUAGES = ["TypeScript", "Python", ".NET", "Java"] as const;
export type Language = (typeof LANGUAGES)[number];

export interface Framework {
  id: string;
  name: string;
  short: string;
  language: Language;
  /** One sentence on what the framework is. */
  summary: string;
  demos: number;
  caps: readonly Capability[];
  popular?: boolean;
}

const ALL: Capability[] = [
  "Generative UI",
  "Human in the loop",
  "Shared state",
  "Subagents",
  "A2UI",
  "Voice",
];
const WITH_INTERRUPTS: Capability[] = [
  ...ALL.slice(0, 3),
  "Interrupts",
  ...ALL.slice(3),
];

export const FRAMEWORKS: Framework[] = [
  {
    id: "built-in-agent",
    name: "CopilotKit",
    short: "CopilotKit",
    language: "TypeScript",
    summary:
      "CopilotKit's own agent, running inside your runtime with no separate backend.",
    demos: 37,
    caps: ALL,
    popular: true,
  },
  {
    id: "mastra",
    name: "Mastra",
    short: "Mastra",
    language: "TypeScript",
    summary: "A TypeScript framework for AI-powered applications and agents.",
    demos: 45,
    caps: WITH_INTERRUPTS,
    popular: true,
  },
  {
    id: "langgraph-python",
    name: "LangGraph (Python)",
    short: "LangGraph",
    language: "Python",
    summary:
      "LangChain's low-level orchestration framework for stateful agents, in Python.",
    demos: 38,
    caps: ALL,
    popular: true,
  },
  {
    id: "langgraph-typescript",
    name: "LangGraph (TypeScript)",
    short: "LangGraph TS",
    language: "TypeScript",
    summary:
      "LangChain's low-level orchestration framework for stateful agents, in TypeScript.",
    demos: 38,
    caps: ALL,
    popular: true,
  },
  {
    id: "crewai-crews",
    name: "CrewAI Flows",
    short: "CrewAI",
    language: "Python",
    summary:
      "Structured, event-driven workflows that chain together Crews and tasks.",
    demos: 42,
    caps: WITH_INTERRUPTS,
    popular: true,
  },
  {
    id: "pydantic-ai",
    name: "Pydantic AI",
    short: "Pydantic AI",
    language: "Python",
    summary:
      "A type-safe Python framework for building agents and LLM applications.",
    demos: 37,
    caps: ALL,
  },
  {
    id: "google-adk",
    name: "Agent Development Kit (ADK)",
    short: "ADK",
    language: "Python",
    summary:
      "Google's open-source framework to build, debug, and deploy AI agents.",
    demos: 38,
    caps: WITH_INTERRUPTS,
  },
  {
    id: "llamaindex",
    name: "LlamaIndex",
    short: "LlamaIndex",
    language: "Python",
    summary: "A Python toolkit for building LLM-powered agents over your data.",
    demos: 36,
    caps: ALL,
  },
  {
    id: "agno",
    name: "Agno",
    short: "Agno",
    language: "Python",
    summary: "The self-improving agent platform.",
    demos: 37,
    caps: ALL,
  },
  {
    id: "ag2",
    name: "AG2",
    short: "AG2",
    language: "Python",
    summary: "An open-source multi-agent framework, formerly AutoGen.",
    demos: 32,
    caps: ALL,
  },
  {
    id: "ms-agent-python",
    name: "Microsoft Agent Framework (Python)",
    short: "Agent Framework",
    language: "Python",
    summary:
      "Microsoft's framework for building AI agents and multi-agent workflows.",
    demos: 39,
    caps: ALL,
  },
  {
    id: "strands",
    name: "Strands Agents (Python)",
    short: "Strands",
    language: "Python",
    summary: "An open-source, model-driven toolkit for production AI agents.",
    demos: 41,
    caps: WITH_INTERRUPTS,
  },
  // The rest of showcase/integrations: every deployed integration is listed.
  {
    id: "strands-typescript",
    name: "Strands Agents (TypeScript)",
    short: "Strands TS",
    language: "TypeScript",
    summary:
      "An open-source, model-driven toolkit for production AI agents, in TypeScript.",
    demos: 42,
    caps: ALL,
  },
  {
    id: "claude-sdk-typescript",
    name: "Claude Agent SDK (TypeScript)",
    short: "Agent SDK TS",
    language: "TypeScript",
    summary:
      "Build production AI agents with Claude Code as a library, in TypeScript.",
    demos: 39,
    caps: ALL,
  },
  {
    id: "claude-sdk-python",
    name: "Claude Agent SDK (Python)",
    short: "Agent SDK",
    language: "Python",
    summary:
      "Build production AI agents with Claude Code as a library, in Python.",
    demos: 38,
    caps: ALL,
  },
  {
    id: "langgraph-fastapi",
    name: "LangGraph (FastAPI)",
    short: "LangGraph API",
    language: "Python",
    summary: "LangGraph agents served from your own FastAPI app.",
    demos: 40,
    caps: ALL,
  },
  {
    id: "google-antigravity",
    name: "Google Antigravity SDK",
    short: "Antigravity",
    language: "Python",
    summary: "Build agents that read files, run commands, and edit code.",
    demos: 36,
    caps: ALL,
  },
  {
    id: "langroid",
    name: "Langroid",
    short: "Langroid",
    language: "Python",
    summary: "A Python framework to harness LLMs with multi-agent programming.",
    demos: 35,
    caps: ALL,
  },
  {
    id: "ms-agent-dotnet",
    name: "Microsoft Agent Framework (.NET)",
    short: "Agent Framework .NET",
    language: ".NET",
    summary:
      "Microsoft's framework for building AI agents and multi-agent workflows, in .NET.",
    demos: 39,
    caps: ALL,
  },
  {
    id: "ms-agent-harness-dotnet",
    name: "Agent Framework Harness (.NET)",
    short: "Harness",
    language: ".NET",
    summary:
      "Agent Framework's batteries-included harness for long-running work.",
    demos: 39,
    caps: ALL,
  },
  {
    id: "spring-ai",
    name: "Spring AI",
    short: "Spring AI",
    language: "Java",
    summary: "Spring's application framework for AI engineering.",
    demos: 37,
    caps: ALL,
  },
];

/**
 * Frameworks that ship in more than one language: one card on the docs home,
 * with the variants a hover away. The first variant is the default.
 */
export type VariantLang = "python" | "typescript" | "fastapi" | "dotnet";

export const FRAMEWORK_FAMILIES: {
  name: string;
  summary: string;
  variants: { id: string; label: string; lang: VariantLang }[];
}[] = [
  {
    name: "LangGraph",
    summary:
      "LangChain's low-level orchestration framework for stateful agents.",
    variants: [
      { id: "langgraph-python", label: "Python", lang: "python" },
      { id: "langgraph-typescript", label: "TypeScript", lang: "typescript" },
      { id: "langgraph-fastapi", label: "FastAPI", lang: "fastapi" },
    ],
  },
  {
    name: "Microsoft Agent Framework",
    summary:
      "Microsoft's framework for building AI agents and multi-agent workflows.",
    variants: [
      { id: "ms-agent-python", label: "Python", lang: "python" },
      { id: "ms-agent-dotnet", label: ".NET", lang: "dotnet" },
      {
        id: "ms-agent-harness-dotnet",
        label: "Harness",
        lang: "dotnet",
      },
    ],
  },
  {
    name: "Strands Agents",
    summary: "An open-source, model-driven toolkit for production AI agents.",
    variants: [
      { id: "strands", label: "Python", lang: "python" },
      { id: "strands-typescript", label: "TypeScript", lang: "typescript" },
    ],
  },
  {
    name: "Claude Agent SDK",
    summary: "Build production AI agents with Claude Code as a library.",
    variants: [
      { id: "claude-sdk-typescript", label: "TypeScript", lang: "typescript" },
      { id: "claude-sdk-python", label: "Python", lang: "python" },
    ],
  },
];

export function frameworkById(id: string): Framework | undefined {
  return FRAMEWORKS.find((f) => f.id === id);
}

export function frontendById(id: string) {
  return FRONTENDS.find((f) => f.id === id);
}

/** Pages that exist for every framework, in sidebar order. */
export const TOPICS = [
  { slug: "quickstart", title: "Quickstart" },
  { slug: "generative-ui", title: "Generative UI" },
  { slug: "human-in-the-loop", title: "Human in the loop" },
  { slug: "shared-state", title: "Shared state" },
  { slug: "threads", title: "Threads" },
] as const;

export type TopicSlug = (typeof TOPICS)[number]["slug"];

export const TOPIC_SUMMARY: Record<TopicSlug, string> = {
  quickstart: "Add a chat to your app and connect it to your agent.",
  "generative-ui":
    "Let your agent render your own components in the chat: cards, charts, forms.",
  "human-in-the-loop": "Pause the agent and ask a person before it acts.",
  "shared-state": "Read and write your agent's state from your app, live.",
  threads: "Keep conversations, and pick them up later.",
};

export function topicBySlug(slug: string) {
  return TOPICS.find((t) => t.slug === slug);
}

export const INTELLIGENCE_PAGES = [
  { slug: "", title: "Overview" },
  { slug: "threads", title: "Rich threads" },
  { slug: "memory", title: "Memory and learning" },
  { slug: "self-hosting", title: "Self-hosting" },
] as const;

export const DEFAULT_FRAMEWORK = "mastra";

export function protoHref(variant: string, section: string, slug?: string) {
  return `/proto/${variant}/${section}${slug ? `/${slug}` : ""}`;
}
