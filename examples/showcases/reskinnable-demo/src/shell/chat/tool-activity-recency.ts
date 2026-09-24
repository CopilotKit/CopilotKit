export interface ToolActivityRecencyStore {
  register(toolCallId: string): void;
  isRecent(toolCallId: string): boolean;
  subscribe(listener: () => void): () => void;
}

/**
 * Stable recency for one chat thread.
 *
 * A tool call's first registration establishes its position. Re-registering the
 * same id (for example after virtualization remounts an old row) is a no-op, so
 * viewport lifecycle can never make old work look recent again.
 */
export function createToolActivityRecencyStore(
  visibleCount: number,
): ToolActivityRecencyStore {
  const order: string[] = [];
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    register(toolCallId) {
      if (order.includes(toolCallId)) return;
      order.push(toolCallId);
      notify();
    },

    isRecent(toolCallId) {
      const index = order.indexOf(toolCallId);
      return index === -1 || index >= order.length - visibleCount;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
