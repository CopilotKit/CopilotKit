const AGENT_ID_OVERRIDES: Readonly<Record<string, string>> = {
  "agentic-chat": "agentic_chat",
  "declarative-hashbrown": "declarative-hashbrown-demo",
  "frontend-tools": "frontend_tools",
};

const CELL_AGENT_ID_OVERRIDES: Readonly<Record<string, string>> = {
  "google-adk/beautiful-chat": "beautiful_chat",
};

const THREAD_ID_OVERRIDES: Readonly<Record<string, string>> = {
  "threadid-frontend-tool-roundtrip": "a9e7e9c4-6c72-4b8a-9d74-c5c0e05f6580",
};

/** Resolve the backend agent used by an exact shared integration contract. */
export function agentIdForFeature(
  feature: string,
  integration?: string,
): string {
  if (integration !== undefined) {
    const cellOverride = CELL_AGENT_ID_OVERRIDES[`${integration}/${feature}`];
    if (cellOverride !== undefined) return cellOverride;
  }
  return AGENT_ID_OVERRIDES[feature] ?? feature;
}

/** Resolve an explicit thread required by a feature-level regression contract. */
export function threadIdForFeature(feature: string): string | undefined {
  return THREAD_ID_OVERRIDES[feature];
}
