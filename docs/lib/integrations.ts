/**
 * Single source of truth for integration ordering and metadata
 * This is used across:
 * - Sidebar integration list (components/ui/sidebar/integration-link.tsx)
 * - Integration dropdown selector (components/ui/integrations-sidebar/integration-selector.tsx)
 * - Integration button grid (components/react/integration-link-button/integration-button-group.tsx)
 * - Integrations grid (components/react/integrations.tsx)
 * - Content structure (content/docs/integrations/meta.json should match this order)
 *
 * NOTE: When changing order here, also update content/docs/integrations/meta.json
 */

// Integration IDs - order matters!
export const INTEGRATION_ORDER = [
  "built-in-agent",
  "langgraph",
  "deepagents",
  "adk",
  "microsoft-agent-framework",
  "aws-strands",
  "mastra",
  "pydantic-ai",
  "crewai-flows",
  "agno",
  "ag2",
  "agent-spec",
  "llamaindex",
  "a2a",
] as const;

export type IntegrationId = (typeof INTEGRATION_ORDER)[number];

// Integration metadata
export interface IntegrationMeta {
  id: IntegrationId;
  label: string;
  href: string;
  description: string;
}

export const INTEGRATION_METADATA: Record<
  IntegrationId,
  Omit<IntegrationMeta, "id">
> = {
  "built-in-agent": {
    label: "Built-in Agent",
    href: "/built-in-agent",
    description:
      "Use CopilotKit's built-in agent — no external framework required.",
  },
  langgraph: {
    label: "LangChain",
    href: "/langgraph",
    description: "Build and deploy stateful AI agents with LangChain.",
  },
  deepagents: {
    label: "Deep Agents",
    href: "/deepagents",
    description: "Build sophisticated AI agents with LangChain's Deep Agents framework.",
  },
  adk: {
    label: "ADK",
    href: "/adk",
    description: "Google's Agent Development Kit for building AI agents.",
  },
  "microsoft-agent-framework": {
    label: "Microsoft Agent Framework",
    href: "/microsoft-agent-framework",
    description: "Microsoft's framework for building AI agents.",
  },
  "aws-strands": {
    label: "AWS Strands",
    href: "/aws-strands",
    description: "AWS SDK for building and orchestrating AI agents.",
  },
  mastra: {
    label: "Mastra",
    href: "/mastra",
    description: "TypeScript framework for building AI agents.",
  },
  "pydantic-ai": {
    label: "Pydantic AI",
    href: "/pydantic-ai",
    description: "Type-safe Python framework for AI agents.",
  },
  "crewai-flows": {
    label: "CrewAI Flows",
    href: "/crewai-flows",
    description: "Orchestrate sequential AI agent workflows.",
  },
  agno: {
    label: "Agno",
    href: "/agno",
    description: "Lightweight framework for building AI agents.",
  },
  ag2: {
    label: "AG2",
    href: "/ag2",
    description: "Microsoft's multi-agent conversation framework.",
  },
  "agent-spec": {
    label: "Open Agent Spec",
    href: "/agent-spec",
    description: "Open standard for defining AI agent interfaces.",
  },
  llamaindex: {
    label: "LlamaIndex",
    href: "/llamaindex",
    description: "Framework for building LLM-powered data applications.",
  },
  a2a: {
    label: "A2A",
    href: "/a2a",
    description:
      "Google's Agent-to-Agent protocol for inter-agent communication.",
  },
};

/**
 * Get all integrations in the canonical order
 */
export function getIntegrations(): IntegrationMeta[] {
  return INTEGRATION_ORDER.map((id) => ({
    id,
    ...INTEGRATION_METADATA[id],
  }));
}

/**
 * Get integration metadata by ID
 */
export function getIntegration(id: IntegrationId): IntegrationMeta {
  return {
    id,
    ...INTEGRATION_METADATA[id],
  };
}
