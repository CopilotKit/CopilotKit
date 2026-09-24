type ToolActivityCall = {
  id: string;
  function: { name: string; arguments?: string };
};

type ToolActivityMessage = {
  id: string;
  role: string;
  toolCalls?: readonly ToolActivityCall[];
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
 * Project only the message fields used for recency. Match the chat view's
 * duplicate handling: first message position, latest tool-call array, missing
 * array falls back to the previous one, and an explicit [] clears it.
 */
function activityMessages(messages: readonly ToolActivityMessage[]) {
  const byId = new Map<string, ToolActivityMessage>();
  for (const message of messages) {
    const previous = byId.get(message.id);
    byId.set(
      message.id,
      message.role === "assistant" && previous?.role === "assistant"
        ? { ...message, toolCalls: message.toolCalls ?? previous.toolCalls }
        : message,
    );
  }
  return byId.values();
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
    renderers
      .filter((renderer) => renderer.name !== "*")
      .map((renderer) => renderer.name),
  );
  const calls = new Map<string, ToolActivityCall>();

  for (const message of activityMessages(messages)) {
    if (message.role !== "assistant") continue;
    // Replayed START events may append an empty duplicate. Preserve the first
    // position, preferring the populated call as the chat view does. Do this
    // before filtering: a replay must not change which renderer owns the slot.
    for (const call of message.toolCalls ?? []) {
      if (!call.id) continue;
      const previous = calls.get(call.id);
      if (!previous || (!previous.function.arguments && call.function.arguments)) {
        calls.set(call.id, call);
      }
    }
  }

  return Array.from(calls.values())
    .filter((call) => {
      const name = call.function.name;
      return name && !isInternalTool(name) && !exactNames.has(name);
    })
    .slice(-visibleCount)
    .map((call) => call.id);
}
