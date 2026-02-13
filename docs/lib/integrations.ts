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
  "adk",
  "a2a",
  "microsoft-agent-framework",
  "aws-strands",
  "direct-to-llm",
  "langgraph",
  "ag2",
  "agno",
  "crewai-crews",
  "crewai-flows",
  "llamaindex",
  "mastra",
  "agent-spec",
  "pydantic-ai",
] as const;

export type IntegrationId = (typeof INTEGRATION_ORDER)[number];

// Integration metadata
export interface IntegrationMeta {
  id: IntegrationId;
  label: string;
  href: string;
}

export const INTEGRATION_METADATA: Record<
  IntegrationId,
  Omit<IntegrationMeta, "id">
> = {
  adk: { label: "ADK", href: "/adk" },
  a2a: { label: "A2A", href: "/a2a" },
  "agent-spec": { label: "Open Agent Spec", href: "/agent-spec" },
  "microsoft-agent-framework": {
    label: "Microsoft Agent Framework",
    href: "/microsoft-agent-framework",
  },
  "aws-strands": { label: "AWS Strands", href: "/aws-strands" },
  "direct-to-llm": { label: "Direct to LLM", href: "/direct-to-llm" },
  langgraph: { label: "LangGraph", href: "/langgraph" },
  ag2: { label: "AG2", href: "/ag2" },
  agno: { label: "Agno", href: "/agno" },
  "crewai-crews": { label: "CrewAI Crews", href: "/crewai-crews" },
  "crewai-flows": { label: "CrewAI Flows", href: "/crewai-flows" },
  llamaindex: { label: "LlamaIndex", href: "/llamaindex" },
  mastra: { label: "Mastra", href: "/mastra" },
  "pydantic-ai": { label: "Pydantic AI", href: "/pydantic-ai" },
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
