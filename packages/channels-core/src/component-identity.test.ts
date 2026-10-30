import { describe, it, expect } from "vitest";
import type {
  ChannelNode,
  ComponentFn,
  InteractionContext,
  Renderable,
} from "@copilotkit/channels-ui";
import { ActionRegistry } from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";

/**
 * A component's durable actions are re-derived after a restart or an
 * eviction by re-rendering the component the snapshot names. That name must
 * identify exactly one function: two different functions that share a
 * `name` (or are both anonymous) must never stand in for each other.
 */

const ctx = {} as InteractionContext;
const scope = { conversationKey: "conv-1", platform: "slack" };

/** A card component; every card made here is named "Card". */
function makeCard(label: string, log: string[]): ComponentFn {
  const Card: ComponentFn = () => ({
    type: "actions",
    props: {
      children: [
        {
          type: "button",
          props: {
            value: { label },
            onClick: () => {
              log.push(label);
            },
            children: label,
          },
        },
      ],
    },
  });
  return Card;
}

function element(type: ComponentFn): Renderable {
  return { type, props: {} } as unknown as Renderable;
}

function buttonId(root: readonly ChannelNode[]): string {
  const button = (root[0]!.props.children as ChannelNode[])[0]!;
  return (button.props.onClick as { id: string }).id;
}

describe("component identity", () => {
  it("never runs another same-named component's handler after an eviction", async () => {
    const log: string[] = [];
    const reg = new ActionRegistry({ store: new InMemoryActionStore() });
    const approve = makeCard("approve", log);
    const destroy = makeCard("destroy", log);
    expect(approve.name).toBe(destroy.name);

    const { root } = await reg.bindRenderable(element(approve), "conv-1");
    await reg.bindRenderable(element(destroy), "conv-1");
    reg.clearHotCache();

    await expect(
      reg.dispatch(buttonId(root), ctx, scope),
    ).rejects.toMatchObject({ code: "channel_action_expired" });
    expect(log).toEqual([]);
  });

  it("never runs another anonymous component's handler after an eviction", async () => {
    const log: string[] = [];
    const reg = new ActionRegistry({ store: new InMemoryActionStore() });
    const first = [makeCard("first", log)].map((fn) => (p: never) => fn(p))[0]!;
    const second = [makeCard("second", log)].map(
      (fn) => (p: never) => fn(p),
    )[0]!;
    expect(first.name).toBe("");

    const { root } = await reg.bindRenderable(
      element(first as ComponentFn),
      "conv-1",
    );
    await reg.bindRenderable(element(second as ComponentFn), "conv-1");
    reg.clearHotCache();

    await expect(
      reg.dispatch(buttonId(root), ctx, scope),
    ).rejects.toMatchObject({ code: "channel_action_expired" });
    expect(log).toEqual([]);
  });

  it("re-derives a component registered under an explicit name", async () => {
    const log: string[] = [];
    const store = new InMemoryActionStore();
    const approve = makeCard("approve", log);
    const reg = new ActionRegistry({ store });
    reg.registerComponent("approval_card", approve as never);

    const { root } = await reg.bindRenderable(element(approve), "conv-1");
    const restarted = new ActionRegistry({ store });
    restarted.registerComponent("approval_card", approve as never);

    await expect(
      restarted.dispatch(buttonId(root), ctx, scope),
    ).resolves.toEqual({ label: "approve" });
    expect(log).toEqual(["approve"]);
  });

  it("throws when a name is registered for a second, different component", () => {
    const reg = new ActionRegistry({ store: new InMemoryActionStore() });
    reg.registerComponent("Card", makeCard("a", []) as never);
    // Registering the same function again is harmless.
    expect(() =>
      reg.registerComponent("Other", makeCard("b", []) as never),
    ).not.toThrow();
    expect(() =>
      reg.registerComponent("Card", makeCard("c", []) as never),
    ).toThrow(/"Card" is already registered/);
  });

  it("allows registering the same component under the same name twice", () => {
    const reg = new ActionRegistry({ store: new InMemoryActionStore() });
    const card = makeCard("a", []);
    reg.registerComponent("Card", card as never);
    expect(() => reg.registerComponent("Card", card as never)).not.toThrow();
  });
});
