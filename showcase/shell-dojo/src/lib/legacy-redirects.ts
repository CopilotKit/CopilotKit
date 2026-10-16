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
//
// `?sidebar=false` was the legacy embed mode (demo only, no dojo chrome).
// The equivalent here is the integration's own demo page, which is what
// the dojo iframes. The legacy dojo's other display params (view, file,
// theme, *Picker, chatDefaultOpen, codeLayout) have no equivalent and are
// dropped.

// Legacy integration id → showcase integration slug. Integrations with no
// showcase counterpart are omitted and land on the dojo root.
export const LEGACY_INTEGRATIONS: Record<string, string> = {
  langgraph: "langgraph-python",
  "langgraph-fastapi": "langgraph-fastapi",
  "langgraph-typescript": "langgraph-typescript",
  mastra: "mastra",
  "mastra-agent-local": "mastra",
  antigravity: "google-antigravity",
  "spring-ai": "spring-ai",
  "pydantic-ai": "pydantic-ai",
  "adk-middleware": "google-adk",
  "microsoft-agent-framework-dotnet": "ms-agent-dotnet",
  "microsoft-agent-framework-python": "ms-agent-python",
  ag2: "ag2",
  agno: "agno",
  "llama-index": "llamaindex",
  // ag-ui READMEs link the unhyphenated spelling.
  llamaindex: "llamaindex",
  crewai: "crewai-crews",
  "crewai-conversational-flows": "crewai-conversational-flows",
  "aws-strands": "strands",
  "aws-strands-typescript": "strands-typescript",
  "claude-agent-sdk-python": "claude-sdk-python",
  "claude-agent-sdk-typescript": "claude-sdk-typescript",
  langroid: "langroid",
  builtin: "built-in-agent",
  "builtin-a2ui": "built-in-agent",
};

// Legacy feature id → showcase demo id. Features with no counterpart are
// omitted and fall back to the integration's default demo.
export const LEGACY_FEATURES: Record<string, string> = {
  agentic_chat: "agentic-chat",
  v1_agentic_chat: "agentic-chat",
  agentic_chat_multimodal: "multimodal",
  agentic_chat_reasoning: "reasoning-default",
  human_in_the_loop: "hitl-in-chat",
  human_in_the_loop_approval: "hitl-in-chat",
  interrupt: "gen-ui-interrupt",
  backend_tool_rendering: "tool-rendering",
  tool_based_generative_ui: "gen-ui-tool-based",
  agentic_generative_ui: "gen-ui-agent",
  open_gen_ui: "open-gen-ui",
  shared_state: "shared-state-read-write",
  predictive_state_updates: "shared-state-streaming",
  subgraphs: "subagents",
  subagents: "subagents",
  deepagents_subagents: "subagents",
  multi_agent: "subagents",
  handoff: "subagents",
  a2ui_fixed_schema: "a2ui-fixed-schema",
  a2ui_fixed_schema_streaming: "a2ui-fixed-schema",
  a2ui_dynamic_schema: "declarative-gen-ui",
  a2ui_advanced: "declarative-gen-ui",
  a2ui_chat: "declarative-gen-ui",
  google_a2ui_dynamic_schema: "declarative-gen-ui",
  google_a2ui_streaming: "declarative-gen-ui",
  google_a2ui_streaming_explicit: "declarative-gen-ui",
  a2ui_recovery: "a2ui-recovery",
  google_a2ui_recovery: "a2ui-recovery",
  background_agents: "background-agents",
  observational_memory: "observational-memory",
};

const LEGACY_PATH = /^\/([^/]+)(?:\/feature\/([^/]+))?\/?$/;

export interface LegacyDojoRedirect {
  location: string;
  /**
   * Dojo URLs are stable (308). The integration demo URL depends on this
   * deployment's backend host pattern, so it must not be cached (307).
   */
  permanent: boolean;
}

export interface LegacyDojoLookups {
  /** Route of `demo` in integration `slug`, if that integration ships it. */
  demoRoute(slug: string, demo: string): string | undefined;
  /** Base URL of integration `slug`'s own app. */
  backendUrl(slug: string): string;
}

/**
 * Resolve a legacy AG-UI dojo URL to its redirect, or `null` when the
 * path is not a legacy dojo route.
 */
export function resolveLegacyDojoRedirect(
  url: URL,
  lookups: LegacyDojoLookups,
): LegacyDojoRedirect | null {
  const match = LEGACY_PATH.exec(url.pathname);
  if (!match) return null;

  const integration = LEGACY_INTEGRATIONS[match[1]];
  if (!integration) return { location: "/", permanent: true };

  const demo = match[2] ? LEGACY_FEATURES[match[2]] : undefined;
  if (demo && url.searchParams.get("sidebar") === "false") {
    const route = lookups.demoRoute(integration, demo);
    if (route) {
      return {
        location: `${lookups.backendUrl(integration)}${route}`,
        permanent: false,
      };
    }
  }

  const params = new URLSearchParams({ integration });
  if (demo) params.set("demo", demo);
  return { location: `/?${params.toString()}`, permanent: true };
}
