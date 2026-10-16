// Redirects for the legacy AG-UI dojo (formerly ag-ui-protocol/ag-ui
// apps/dojo, served at dojo.ag-ui.com). That app used path routes:
//
//   /<integrationId>
//   /<integrationId>/feature/<featureId>[?sidebar=false]
//
// This dojo is a single page driven by ?integration=<slug>&demo=<id>, so
// every legacy path 404s. Old links are still live on copilotkit.ai, in
// blog posts and in third-party READMEs; map them onto the closest
// showcase integration + demo instead.

// Legacy integration id → showcase integration slug. Integrations with no
// showcase counterpart are omitted and land on the dojo root.
export const LEGACY_INTEGRATIONS: Record<string, string> = {
  langgraph: "langgraph-python",
  "langgraph-fastapi": "langgraph-fastapi",
  "langgraph-typescript": "langgraph-typescript",
  mastra: "mastra",
  "mastra-agent-local": "mastra",
  "spring-ai": "spring-ai",
  "pydantic-ai": "pydantic-ai",
  "adk-middleware": "google-adk",
  "microsoft-agent-framework-dotnet": "ms-agent-dotnet",
  "microsoft-agent-framework-python": "ms-agent-python",
  ag2: "ag2",
  agno: "agno",
  "llama-index": "llamaindex",
  crewai: "crewai-crews",
  "aws-strands": "strands",
  "aws-strands-typescript": "strands-typescript",
  "claude-agent-sdk-python": "claude-sdk-python",
  "claude-agent-sdk-typescript": "claude-sdk-typescript",
  langroid: "langroid",
  builtin: "built-in-agent",
};

// Legacy feature id → showcase demo id. Features with no counterpart are
// omitted and fall back to the integration's default demo.
export const LEGACY_FEATURES: Record<string, string> = {
  agentic_chat: "agentic-chat",
  v1_agentic_chat: "agentic-chat",
  agentic_chat_multimodal: "multimodal",
  agentic_chat_reasoning: "reasoning-default",
  human_in_the_loop: "hitl-in-chat",
  interrupt: "gen-ui-interrupt",
  backend_tool_rendering: "tool-rendering",
  tool_based_generative_ui: "gen-ui-tool-based",
  agentic_generative_ui: "gen-ui-agent",
  shared_state: "shared-state-read-write",
  predictive_state_updates: "shared-state-streaming",
  subgraphs: "subagents",
  a2ui_fixed_schema: "a2ui-fixed-schema",
  a2ui_dynamic_schema: "declarative-gen-ui",
  a2ui_advanced: "declarative-gen-ui",
  a2ui_recovery: "a2ui-recovery",
  background_agents: "background-agents",
  observational_memory: "observational-memory",
};

const LEGACY_PATH = /^\/([^/]+)(?:\/feature\/([^/]+))?\/?$/;

/**
 * Resolve a legacy AG-UI dojo pathname to a showcase dojo URL (path +
 * query), or `null` when the path is not a legacy dojo route.
 */
export function resolveLegacyDojoPath(pathname: string): string | null {
  const match = LEGACY_PATH.exec(pathname);
  if (!match) return null;

  const integration = LEGACY_INTEGRATIONS[match[1]];
  if (!integration) return "/";

  const params = new URLSearchParams({ integration });
  const demo = match[2] && LEGACY_FEATURES[match[2]];
  if (demo) params.set("demo", demo);
  return `/?${params.toString()}`;
}
