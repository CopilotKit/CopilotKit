type ToolActivityMessage = {
  role: string;
  toolCalls?: readonly {
    id: string;
    function: { name: string };
  }[];
};

const HIDDEN_TOOL_PATTERNS = [
  /^agui/i,
  /sendstatedelta/i,
  /^a2ui/i,
  /^copilotkit_/i,
];

export function isInternalTool(name: string): boolean {
  return HIDDEN_TOOL_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * The last wildcard activities in conversation order, not viewport order.
 * Exact renderers own their own cards and must not consume this window. This
 * matches useRenderToolCall's exact-name-before-wildcard selection; agentId
 * only chooses between exact matches, it does not make them wildcard calls.
 */
export function selectRecentToolActivity(
  messages: readonly ToolActivityMessage[],
  renderers: readonly { name: string }[],
  visibleCount: number,
): string[] {
  if (visibleCount <= 0 || !renderers.some((renderer) => renderer.name === "*")) {
    return [];
  }
  const exactNames = new Set(
    renderers.filter((renderer) => renderer.name !== "*").map((renderer) => renderer.name),
  );
  const seen = new Set<string>();
  const recent: string[] = [];

  // Stop once the small visible window is full. Streamed args/results do not
  // change recency, and neither does an off-screen row's first mount.
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    const calls = message.toolCalls ?? [];
    for (let j = calls.length - 1; j >= 0; j--) {
      const call = calls[j];
      if (!call.id || seen.has(call.id)) continue;
      seen.add(call.id);
      const name = call.function.name;
      if (!name || isInternalTool(name) || exactNames.has(name)) continue;
      recent.push(call.id);
      if (recent.length === visibleCount) return recent.reverse();
    }
  }
  return recent.reverse();
}
