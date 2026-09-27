export interface LearningThreadScope {
  kind: "chat" | "agent";
  getThreadId: () => string | undefined;
}

/** One attribution decision per provider; background runs never select a chat. */
export function createLearningThreadRegistry() {
  const scopes = new Map<symbol, LearningThreadScope>();
  let selected: symbol | undefined;

  return {
    set(id: symbol, scope: LearningThreadScope) {
      scopes.set(id, scope);
    },
    remove(id: symbol) {
      scopes.delete(id);
      // Retain the token across StrictMode cleanup/re-registration. Removed
      // scopes are never candidates, so a real unmount cannot return its thread.
    },
    activate(id: symbol) {
      // A descendant can autofocus before its chat's layout effect registers.
      selected = id;
    },
    getThreadId() {
      const chats = [...scopes.entries()].filter(([, s]) => s.kind === "chat");
      const candidates = chats.length ? chats : [...scopes.entries()];
      const active = candidates.find(([id]) => id === selected);
      if (active) return active[1].getThreadId();
      const threads = new Set(candidates.map(([, s]) => s.getThreadId()));
      // With no selected chat, only an unambiguous mounted thread is eligible.
      // Never mint a product-only session or broadcast to unrelated threads.
      return threads.size === 1 ? threads.values().next().value : undefined;
    },
  };
}

export type LearningThreadRegistry = ReturnType<
  typeof createLearningThreadRegistry
>;
