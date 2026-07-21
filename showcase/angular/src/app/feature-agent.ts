const AGENT_ID_OVERRIDES: Readonly<Record<string, string>> = {
  "agentic-chat": "agentic_chat",
  "frontend-tools": "frontend_tools",
};

/** Resolve the backend agent used by a feature's shared integration contract. */
export function agentIdForFeature(feature: string): string {
  return AGENT_ID_OVERRIDES[feature] ?? feature;
}
