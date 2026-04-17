export interface CapturedRegistry {
  v1: {
    actions: Record<string, unknown>;
    coAgentStateRenders: unknown[];
    chatComponents: unknown;
  };
  v2: {
    tools: unknown[];
    renderToolCalls: unknown[];
  };
}
