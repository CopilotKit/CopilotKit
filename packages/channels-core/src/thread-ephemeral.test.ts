import { describe, it, expect } from "vitest";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { Thread } from "./thread.js";
import type { ThreadDeps } from "./thread.js";
import { DirectAdapterEgress } from "./channel-egress.js";
import { MemoryStore } from "./state/memory-store.js";
import type { ActionRegistry } from "./action-registry.js";

async function runOnMessage(
  fake: FakeAdapter,
  fn: Parameters<ReturnType<typeof createChannel>["onMessage"]>[0],
) {
  const channel = createChannel({ adapters: [fake] });
  channel.onMessage(fn);
  await channel.start();
  fake.emitTurn({ userText: "hi", user: { id: "U1" } });
  await new Promise((r) => setTimeout(r, 0));
}

describe("Thread.postEphemeral", () => {
  it("posts natively when the surface supports it (usedFallback=false)", async () => {
    const fake = new FakeAdapter({ nativeEphemeral: true });
    let res: unknown;
    await runOnMessage(fake, async ({ thread, message }) => {
      res = await thread.postEphemeral(message.user, "psst", {
        fallbackToDM: false,
      });
    });
    expect(res).toMatchObject({ ok: true, usedFallback: false });
    expect(fake.ephemeralPosts).toHaveLength(1);
    // Renderable was bound to IR before reaching the adapter.
    expect(Array.isArray(fake.ephemeralPosts[0]!.ir)).toBe(true);
  });

  it("DM-falls-back when native is unsupported and fallbackToDM=true (usedFallback=true)", async () => {
    const fake = new FakeAdapter({ nativeEphemeral: false });
    let res: unknown;
    await runOnMessage(fake, async ({ thread, message }) => {
      res = await thread.postEphemeral(message.user, "psst", {
        fallbackToDM: true,
      });
    });
    expect(res).toMatchObject({ ok: true, usedFallback: true });
  });

  it("returns null when native unsupported and fallbackToDM=false", async () => {
    const fake = new FakeAdapter({ nativeEphemeral: false });
    let res: unknown = "sentinel";
    await runOnMessage(fake, async ({ thread, message }) => {
      res = await thread.postEphemeral(message.user, "psst", {
        fallbackToDM: false,
      });
    });
    expect(res).toBeNull();
  });

  it("short-circuits BEFORE binding when the surface can't post ephemerally at all", async () => {
    // Binding mints + durably persists action ids for interactive UI; a surface
    // with no `postEphemeral` must return the capability error WITHOUT binding,
    // else it would leave a durable action for a message that is never sent.
    const adapter = new FakeAdapter();
    (adapter as { postEphemeral?: unknown }).postEphemeral = undefined;
    let bindCalls = 0;
    const registry = {
      bindRenderable: async () => {
        bindCalls++;
        throw new Error(
          "bindRenderable must not run for an unsupported surface",
        );
      },
    } as unknown as ActionRegistry;
    const deps: ThreadDeps = {
      adapter,
      egress: new DirectAdapterEgress(adapter),
      replyTarget: {},
      conversationKey: "c1",
      registry,
      agentFactory: () => {
        throw new Error("agentFactory unused in this test");
      },
      tools: new Map(),
      toolDescriptors: [],
      context: [],
      registerWaiter: () => {},
      interruptHandlers: new Map(),
      state: new MemoryStore(),
    };
    const thread = new Thread(deps);
    const res = await thread.postEphemeral("U1", "psst", {
      fallbackToDM: true,
    });
    expect(res).toEqual({
      ok: false,
      error: "fake does not support ephemeral messages",
    });
    expect(bindCalls).toBe(0);
  });
});
