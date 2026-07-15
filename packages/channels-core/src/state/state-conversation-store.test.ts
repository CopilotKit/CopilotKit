import { describe, it, expect } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { MemoryStore } from "./memory-store.js";
import { createStateBackedConversationStore } from "./state-conversation-store.js";

describe("createStateBackedConversationStore", () => {
  it("two stores sharing one MemoryStore yield the same persisted threadId", async () => {
    const mem = new MemoryStore();

    // Minimal stub — makeAgent only needs to accept a threadId; the test captures it.
    const capturedIds: string[] = [];
    const makeAgent = (threadId: string): AbstractAgent => {
      capturedIds.push(threadId);
      // Return a minimal object that satisfies AbstractAgent structurally.
      return {} as AbstractAgent;
    };

    const store1 = createStateBackedConversationStore(mem);
    const store2 = createStateBackedConversationStore(mem);

    const target = {};

    const session1 = await store1.getOrCreate("c1", target, makeAgent);
    const session2 = await store2.getOrCreate("c1", target, makeAgent);

    // Both calls should have reached makeAgent with the SAME threadId.
    expect(capturedIds).toHaveLength(2);
    expect(capturedIds[0]).toBe(capturedIds[1]);

    // The threadId must be a valid UUID (minted on first call).
    expect(capturedIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    // Both sessions carry the agent returned by makeAgent.
    expect(session1.agent).toBeDefined();
    expect(session2.agent).toBeDefined();
  });

  it("different conversationKeys get distinct threadIds", async () => {
    const mem = new MemoryStore();
    const store = createStateBackedConversationStore(mem);
    const target = {};

    const ids: string[] = [];
    const makeAgent = (threadId: string): AbstractAgent => {
      ids.push(threadId);
      return {} as AbstractAgent;
    };

    await store.getOrCreate("c1", target, makeAgent);
    await store.getOrCreate("c2", target, makeAgent);

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("respects idTtlMs — expired mapping mints a new threadId", async () => {
    const mem = new MemoryStore();
    const store = createStateBackedConversationStore(mem, { idTtlMs: 30 });
    const target = {};

    const ids: string[] = [];
    const makeAgent = (threadId: string): AbstractAgent => {
      ids.push(threadId);
      return {} as AbstractAgent;
    };

    await store.getOrCreate("c1", target, makeAgent);
    // Wait for the TTL to expire.
    await new Promise((r) => setTimeout(r, 60));
    await store.getOrCreate("c1", target, makeAgent);

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
