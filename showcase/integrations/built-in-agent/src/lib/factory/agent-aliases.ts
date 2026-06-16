export function createAgentAliases<TAgent>(
  names: readonly string[],
  createAgent: () => TAgent,
): Record<string, TAgent> {
  return Object.fromEntries(names.map((name) => [name, createAgent()]));
}

export const DEFAULT_BUILT_IN_AGENT_NAMES = [
  "default",
  "agentic_chat",
  "gen-ui-tool-based",
  "shared-state-read",
  "hitl-in-chat",
  "hitl-in-app",
  "human_in_the_loop",
  "gen-ui-interrupt",
  "interrupt-headless",
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "chat-customization-css",
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  "tool-rendering",
  "frontend_tools",
  "frontend-tools-async",
  "gen-ui-agent",
  "shared-state-read-write",
  "shared-state-streaming",
  "readonly-state-agent-context",
  "subagents",
  "headless-simple",
  "threadid-frontend-tool-roundtrip",
] as const;
