export interface StaticSuggestion {
  title: string;
  message: string;
}

/** Resolve the backend agent used by the implemented Vue feature. */
export function agentIdForFeature(_feature: "agentic-chat"): "agentic_chat" {
  return "agentic_chat";
}

/** Agentic chat intentionally uses runtime-provided suggestions only. */
export function suggestionsForFeature(
  _feature: "agentic-chat",
): readonly StaticSuggestion[] {
  return [];
}
