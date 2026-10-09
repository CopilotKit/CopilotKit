import { expect, test } from "vitest";
import { ActionRegistry } from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";
import { MemoryStore } from "./state/memory-store.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { Thread } from "./thread.js";
import type { ThreadDeps } from "./thread.js";

function setupThreadWithSyncDeleteFailure(failure: Error): Thread {
  const adapter = new FakeAdapter();
  adapter.delete = () => {
    throw failure;
  };
  const deps: ThreadDeps = {
    adapter,
    replyTarget: {},
    conversationKey: "thread-promise-contract",
    channelName: "test",
    threadId: "thread-promise-contract",
    registry: new ActionRegistry({ store: new InMemoryActionStore() }),
    agentFactory: (threadId) => {
      throw new Error(`agentFactory not needed in this test: ${threadId}`);
    },
    tools: new Map(),
    toolDescriptors: [],
    context: [],
    registerWaiter: () => undefined,
    interruptHandlers: new Map(),
    state: new MemoryStore(),
    user: null,
    actor: { id: "actor", kind: "unknown" },
  };
  return new Thread(deps);
}

test("a synchronous non-managed adapter failure returns a rejected Promise", async () => {
  const failure = new Error("adapter delete failed synchronously");
  const thread = setupThreadWithSyncDeleteFailure(failure);
  let deletion: Promise<void> | undefined;

  expect(() => {
    deletion = thread.delete({ id: "message-1" });
  }).not.toThrow();
  await expect(deletion).rejects.toBe(failure);
});
