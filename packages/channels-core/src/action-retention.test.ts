import { describe, it, expect, vi, afterEach } from "vitest";
import { Actions, Button } from "@copilotkit/channels-ui";
import type { ChannelNode, InteractionContext } from "@copilotkit/channels-ui";
import { ActionRegistry } from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";
import { MemoryStore } from "./state/memory-store.js";

/**
 * Every rendered control mints a fresh random action id, so the registry's
 * in-process cache and the durable store must evict on their own: entries
 * expire after the retention window, and the in-process cache is also capped.
 */

const ctx = {} as InteractionContext;
const scope = { conversationKey: "conv-1", platform: "slack" };

function buttonIds(nodes: ChannelNode[]): string[] {
  const ids: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null || !("props" in value)) {
      return;
    }
    const node = value as ChannelNode;
    const onClick = node.props.onClick as { id?: unknown } | undefined;
    if (typeof onClick?.id === "string") ids.push(onClick.id);
    for (const propValue of Object.values(node.props)) visit(propValue);
  };
  visit(nodes);
  return ids;
}

async function bindInline(reg: ActionRegistry, clicks: number[], n: number) {
  const { root } = await reg.bindRenderable(
    Actions({
      children: [
        Button({
          value: { n },
          onClick: () => {
            clicks.push(n);
          },
          children: `#${n}`,
        }),
      ],
    }),
    "conv-1",
  );
  return buttonIds(root)[0]!;
}

function Confirm(): ChannelNode {
  return {
    type: "actions",
    props: {
      children: [
        {
          type: "button",
          props: { value: { ok: true }, onClick: () => {}, children: "OK" },
        },
      ],
    },
  };
}

describe("action retention", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("caps the in-process action cache, evicting the least recently used entry", async () => {
    const reg = new ActionRegistry({
      store: new InMemoryActionStore(),
      maxHotActions: 2,
    });
    const clicks: number[] = [];
    const first = await bindInline(reg, clicks, 1);
    const second = await bindInline(reg, clicks, 2);
    // Touch the first entry so the second becomes the least recently used.
    await reg.dispatch(first, ctx, scope);
    const third = await bindInline(reg, clicks, 3);

    // An evicted inline handler cannot be re-derived, so it reports expired.
    await expect(reg.dispatch(second, ctx, scope)).rejects.toMatchObject({
      code: "channel_action_expired",
    });
    await reg.dispatch(first, ctx, scope);
    await reg.dispatch(third, ctx, scope);
    expect(clicks).toEqual([1, 1, 3]);
  });

  it("expires in-process actions after the retention window", async () => {
    vi.useFakeTimers();
    const reg = new ActionRegistry({
      store: new InMemoryActionStore(),
      retentionMs: 1_000,
    });
    const clicks: number[] = [];
    const id = await bindInline(reg, clicks, 1);
    vi.advanceTimersByTime(1_001);
    await expect(reg.dispatch(id, ctx, scope)).rejects.toMatchObject({
      code: "channel_action_expired",
    });
    expect(clicks).toEqual([]);
  });

  it("stores every action snapshot with the retention TTL, even in a store without a default TTL", async () => {
    vi.useFakeTimers();
    const store = new InMemoryActionStore();
    const first = new ActionRegistry({ store, retentionMs: 1_000 });
    first.registerComponent("Confirm", Confirm as never);
    const [id] = buttonIds(await first.bindTree("Confirm", {}, "conv-1"));

    const restarted = new ActionRegistry({ store, retentionMs: 1_000 });
    restarted.registerComponent("Confirm", Confirm as never);
    vi.advanceTimersByTime(1_001);
    await expect(restarted.dispatch(id!, ctx, scope)).rejects.toMatchObject({
      code: "channel_action_expired",
    });
  });

  it("purges expired entries from the in-memory stores as new ones are written", async () => {
    vi.useFakeTimers();
    const kv = new MemoryStore();
    const actions = new InMemoryActionStore();
    for (let i = 0; i < 100; i++) {
      await kv.kv.set(`old-${i}`, i, 1_000);
      await actions.put(
        `ck:old-${i}`,
        { path: [], conversationKey: "c" },
        1_000,
      );
    }
    vi.advanceTimersByTime(1_001);
    for (let i = 0; i < 1_000; i++) {
      await kv.kv.set(`new-${i}`, i, 60_000);
      await actions.put(
        `ck:new-${i}`,
        { path: [], conversationKey: "c" },
        60_000,
      );
    }
    const kvSize = (kv as unknown as { kvMap: Map<string, unknown> }).kvMap
      .size;
    const actionsSize = (actions as unknown as { map: Map<string, unknown> })
      .map.size;
    expect(kvSize).toBe(1_000);
    expect(actionsSize).toBe(1_000);
  });
});
