import { describe, it, expect } from "vitest";
import { Thread } from "./thread.js";
import type { ThreadDeps } from "./thread.js";
import { MemoryStore } from "./state/memory-store.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { DirectAdapterEgress } from "./channel-egress.js";
import { ActionRegistry } from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";

function makeTestThread(overrides: {
  state: MemoryStore;
  conversationKey?: string;
}): Thread {
  const adapter = new FakeAdapter();
  const registry = new ActionRegistry({ store: new InMemoryActionStore() });
  const deps: ThreadDeps = {
    adapter,
    egress: new DirectAdapterEgress(adapter),
    replyTarget: {},
    conversationKey: overrides.conversationKey ?? "c1",
    registry,
    agentFactory: (id) => {
      throw new Error(`agentFactory not needed in this test: ${id}`);
    },
    tools: new Map(),
    toolDescriptors: [],
    context: [],
    registerWaiter: () => {},
    interruptHandlers: new Map(),
    state: overrides.state,
  };
  return new Thread(deps);
}

describe("Thread.subscribe / unsubscribe / isSubscribed", () => {
  it("subscribe marks the conversation as subscribed", async () => {
    const state = new MemoryStore();
    const thread = makeTestThread({ state, conversationKey: "c1" });
    await thread.subscribe();
    expect(await thread.isSubscribed()).toBe(true);
  });

  it("unsubscribe removes the subscription", async () => {
    const state = new MemoryStore();
    const thread = makeTestThread({ state, conversationKey: "c1" });
    await thread.subscribe();
    await thread.unsubscribe();
    expect(await thread.isSubscribed()).toBe(false);
  });

  it("isSubscribed returns false before any subscribe call", async () => {
    const state = new MemoryStore();
    const thread = makeTestThread({ state, conversationKey: "c1" });
    expect(await thread.isSubscribed()).toBe(false);
  });

  it("subscription state is keyed per conversationKey", async () => {
    const state = new MemoryStore();
    const t1 = makeTestThread({ state, conversationKey: "c1" });
    const t2 = makeTestThread({ state, conversationKey: "c2" });
    await t1.subscribe();
    expect(await t1.isSubscribed()).toBe(true);
    expect(await t2.isSubscribed()).toBe(false);
  });
});

describe("Thread.setState / state", () => {
  it("round-trips an arbitrary object", async () => {
    const state = new MemoryStore();
    const thread = makeTestThread({ state, conversationKey: "c1" });
    await thread.setState({ step: "ask_name" });
    expect(await thread.state<{ step: string }>()).toEqual({
      step: "ask_name",
    });
  });

  it("returns undefined before any setState call", async () => {
    const state = new MemoryStore();
    const thread = makeTestThread({ state, conversationKey: "c1" });
    expect(await thread.state()).toBeUndefined();
  });

  it("overwrites a previous value", async () => {
    const state = new MemoryStore();
    const thread = makeTestThread({ state, conversationKey: "c1" });
    await thread.setState({ step: "ask_name" });
    await thread.setState({ step: "confirm" });
    expect(await thread.state<{ step: string }>()).toEqual({ step: "confirm" });
  });

  it("state is keyed per conversationKey", async () => {
    const state = new MemoryStore();
    const t1 = makeTestThread({ state, conversationKey: "c1" });
    const t2 = makeTestThread({ state, conversationKey: "c2" });
    await t1.setState({ v: 1 });
    expect(await t2.state()).toBeUndefined();
  });
});
