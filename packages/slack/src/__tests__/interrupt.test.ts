import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  defineInterruptHandler,
  DEFAULT_INTERRUPT_EVENT_NAME,
} from "../interrupt.js";
import { createSlackEventRenderer } from "../event-renderer.js";

describe("defineInterruptHandler", () => {
  it("preserves the bundle and uses on_interrupt as the default event name", () => {
    const handler = defineInterruptHandler({
      name: "test_picker",
      description: "d",
      payload: z.object({ topic: z.string() }),
      render: () => [{ type: "divider" }],
    });
    expect(handler.name).toBe("test_picker");
    expect(handler.eventName).toBeUndefined(); // default applied at lookup time
    expect(DEFAULT_INTERRUPT_EVENT_NAME).toBe("on_interrupt");
  });
});

describe("renderer captures on_interrupt custom events", () => {
  function makeFakeClient() {
    const posts: unknown[] = [];
    const updates: unknown[] = [];
    let n = 0;
    const client = {
      chat: {
        postMessage: async (args: unknown) => {
          n++;
          posts.push(args);
          return { ok: true, ts: `${n}.0` };
        },
        update: async (args: unknown) => {
          updates.push(args);
          return { ok: true };
        },
      },
    };
    return { client, posts, updates };
  }

  it("captures an `on_interrupt` custom event into getPendingInterrupt", async () => {
    const fake = makeFakeClient();
    const { subscriber, getPendingInterrupt } = createSlackEventRenderer({
      client: fake.client as never,
      target: { channel: "C1", threadTs: "100.0" },
    });
    await subscriber.onCustomEvent!({
      event: {
        name: "on_interrupt",
        value: { topic: "Meet", slots: [{ label: "A", iso: "x" }] },
      },
    } as never);
    const pending = getPendingInterrupt();
    expect(pending).toBeDefined();
    expect(pending?.eventName).toBe("on_interrupt");
    expect(pending?.value).toMatchObject({ topic: "Meet" });
  });

  it("does NOT capture unrelated custom events", async () => {
    const fake = makeFakeClient();
    const { subscriber, getPendingInterrupt } = createSlackEventRenderer({
      client: fake.client as never,
      target: { channel: "C1", threadTs: "100.0" },
    });
    await subscriber.onCustomEvent!({
      event: { name: "something_else", value: { x: 1 } },
    } as never);
    expect(getPendingInterrupt()).toBeUndefined();
  });

  it("supports custom interruptEventNames sets", async () => {
    const fake = makeFakeClient();
    const { subscriber, getPendingInterrupt } = createSlackEventRenderer({
      client: fake.client as never,
      target: { channel: "C1", threadTs: "100.0" },
      interruptEventNames: new Set(["my_pause"]),
    });
    // The default name should NOT match now.
    await subscriber.onCustomEvent!({
      event: { name: "on_interrupt", value: {} },
    } as never);
    expect(getPendingInterrupt()).toBeUndefined();
    await subscriber.onCustomEvent!({
      event: { name: "my_pause", value: { ok: true } },
    } as never);
    expect(getPendingInterrupt()?.eventName).toBe("my_pause");
  });

  it("clearPendingInterrupt removes the captured event", async () => {
    const fake = makeFakeClient();
    const { subscriber, getPendingInterrupt, clearPendingInterrupt } =
      createSlackEventRenderer({
        client: fake.client as never,
        target: { channel: "C1", threadTs: "100.0" },
      });
    await subscriber.onCustomEvent!({
      event: { name: "on_interrupt", value: {} },
    } as never);
    expect(getPendingInterrupt()).toBeDefined();
    clearPendingInterrupt();
    expect(getPendingInterrupt()).toBeUndefined();
  });

  it("ignores interrupt events that arrive after markInterrupted (abort)", async () => {
    const fake = makeFakeClient();
    const handle = createSlackEventRenderer({
      client: fake.client as never,
      target: { channel: "C1", threadTs: "100.0" },
    });
    await handle.markInterrupted();
    await handle.subscriber.onCustomEvent!({
      event: { name: "on_interrupt", value: {} },
    } as never);
    expect(handle.getPendingInterrupt()).toBeUndefined();
  });
});
