// The ported shell-docs content embeds the legacy AG-UI dojo
// (feature-viewer.copilotkit.ai/<integration>/feature/<feature>), which draws
// its own chrome. These maps send each of those embeds to the showcase's own
// demo instead: the same cell the showcase tests exercise, with its source.
//
// Copied from showcase/shell-dojo/src/lib/legacy-redirects.ts, which redirects
// the same legacy URLs; keep the two in step.

import { getRegistry } from "./data";

/** Legacy integration id → showcase integration slug. */
const LEGACY_INTEGRATIONS: Record<string, string> = {
  langgraph: "langgraph-python",
  "langgraph-fastapi": "langgraph-fastapi",
  "langgraph-typescript": "langgraph-typescript",
  mastra: "mastra",
  "mastra-agent-local": "mastra",
  antigravity: "google-antigravity",
  "spring-ai": "spring-ai",
  "pydantic-ai": "pydantic-ai",
  "adk-middleware": "google-adk",
  "adk-js": "google-adk",
  "microsoft-agent-framework-dotnet": "ms-agent-dotnet",
  "microsoft-agent-framework-python": "ms-agent-python",
  ag2: "ag2",
  agno: "agno",
  "llama-index": "llamaindex",
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

/** Legacy feature id → showcase demo id. */
const LEGACY_FEATURES: Record<string, string> = {
  agentic_chat: "agentic-chat",
  v1_agentic_chat: "agentic-chat",
  agentic_chat_multimodal: "multimodal",
  agentic_chat_reasoning: "reasoning-default",
  human_in_the_loop: "hitl-in-chat",
  human_in_the_loop_approval: "hitl-in-chat",
  tool_approval: "hitl-in-chat",
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

const LEGACY_PATH = /^\/([^/]+)\/feature\/([^/]+)\/?$/;

/**
 * The showcase demo a legacy dojo URL stands for, when the showcase deploys
 * that integration and ships that demo; otherwise null.
 */
export function showcaseDemoFor(
  url: string,
): { integration: string; demo: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "feature-viewer.copilotkit.ai") return null;
  const match = LEGACY_PATH.exec(parsed.pathname);
  if (!match) return null;
  const integration = LEGACY_INTEGRATIONS[match[1]];
  const demo = LEGACY_FEATURES[match[2]];
  if (!integration || !demo) return null;
  const int = getRegistry().integrations.find((i) => i.slug === integration);
  if (!int?.deployed || !int.demos.some((d) => d.id === demo)) return null;
  return { integration, demo };
}
