const AGENT_BY_FEATURE: Readonly<Record<string, string>> = {
  "agent-config": "agent-config-demo",
  "agentic-chat": "agentic_chat",
  auth: "auth-demo",
  "frontend-tools": "frontend_tools",
  multimodal: "multimodal-demo",
  voice: "voice-demo",
};

const INTEGRATION_AGENT_OVERRIDES: Readonly<Record<string, string>> = {
  "llamaindex/reasoning-custom": "agentic-chat-reasoning",
  "llamaindex/reasoning-default": "reasoning-default-render",
  "pydantic-ai/frontend-tools": "frontend-tools",
};

const THREAD_ID_OVERRIDES: Readonly<Record<string, string>> = {
  "threadid-frontend-tool-roundtrip": "a9e7e9c4-6c72-4b8a-9d74-c5c0e05f6580",
};

export interface StaticSuggestion {
  title: string;
  message: string;
}

/** Resolve the backend agent used by an exact shared integration contract. */
export function agentIdForFeature(
  feature: string,
  integration: string,
): string {
  return (
    INTEGRATION_AGENT_OVERRIDES[`${integration}/${feature}`] ??
    AGENT_BY_FEATURE[feature] ??
    feature
  );
}

/** Resolve an explicit thread required by a feature regression contract. */
export function threadIdForFeature(feature: string): string | undefined {
  return THREAD_ID_OVERRIDES[feature];
}

/** Agentic chat intentionally uses runtime-provided suggestions only. */
export function suggestionsForFeature(
  _feature: string,
): readonly StaticSuggestion[] {
  return [];
}
