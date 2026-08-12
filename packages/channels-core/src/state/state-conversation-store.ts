import { randomUUID } from "node:crypto";
import type { AbstractAgent } from "@ag-ui/client";
import type {
  ConversationStore,
  AgentSession,
  ReplyTarget,
} from "../platform-adapter.js";
import type { StateStore } from "./state-store.js";

/**
 * A {@link ConversationStore} backed by `StateStore.kv`.
 *
 * Persists the `conversationKey → threadId` mapping under the key
 * `conv:<conversationKey>`, so the same stable agent thread is reused across
 * process restarts and multiple instances sharing the same store backend.
 * Agent instances are still created per-process via `makeAgent`.
 */
export function createStateBackedConversationStore(
  state: StateStore,
  opts?: { idTtlMs?: number },
): ConversationStore {
  return {
    async getOrCreate(
      conversationKey: string,
      _replyTarget: ReplyTarget,
      makeAgent: (threadId: string) => AbstractAgent,
    ): Promise<AgentSession> {
      const k = `conv:${conversationKey}`;
      let threadId = await state.kv.get<string>(k);
      if (!threadId) {
        threadId = randomUUID();
        await state.kv.set(k, threadId, opts?.idTtlMs);
      }
      return { agent: makeAgent(threadId) };
    },
  };
}
