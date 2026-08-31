/** @jsxImportSource @copilotkit/channels-ui */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { Message, Header, Render, Button } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { Thread } from "./thread.js";
import type { ThreadDeps } from "./thread.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { ActionRegistry } from "./action-registry.js";
import { MemoryStore } from "./state/memory-store.js";
import { kvActionStore } from "./state/kv-action-store.js";

function makeThread(
  adapter: FakeAdapter,
  renderImage: ThreadDeps["renderImage"] = async () =>
    new Uint8Array([1, 2, 3]),
) {
  const store = new MemoryStore();
  const deps: ThreadDeps = {
    adapter,
    replyTarget: {},
    conversationKey: "c",
    channelName: "test",
    threadId: "c",
    registry: new ActionRegistry({ store: kvActionStore(store) }),
    agentFactory: () => {
      throw new Error("no agent");
    },
    tools: new Map(),
    toolDescriptors: [],
    context: [],
    registerWaiter: () => {},
    interruptHandlers: new Map(),
    state: store,
    user: null,
    actor: { id: "actor", kind: "unknown" },
    renderImage,
  };
  return new Thread(deps);
}

const mixedUi = (
  <Message>
    <Header>Week</Header>
    <Render alt="card">
      <div>hi</div>
    </Render>
  </Message>
);

describe("Thread.post / update Render trees", () => {
  it("posts a mixed Message+Render tree through stageFile, not postFile", async () => {
    const adapter = new FakeAdapter();
    const staged: string[] = [];
    adapter.stageFile = async (_t, args) => {
      staged.push(args.altText);
      return { fileId: "F-staged" };
    };
    adapter.postFile = async () => {
      throw new Error("postFile must not run for mixed Render");
    };
    const thread = makeThread(adapter);

    const ref = await thread.post(mixedUi);

    expect(staged).toEqual(["card"]);
    expect(ref.id).toBeTruthy();
    expect(adapter.posted).toHaveLength(1);
    const images = collect(adapter.posted[0]!, "image");
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      type: "image",
      props: { alt: "card", fileId: "F-staged" },
    });
    expect(collect(adapter.posted[0]!, "render")).toHaveLength(0);
  });

  it("pings keepAlive before Takumi stages a Render tree", async () => {
    const adapter = new FakeAdapter();
    const order: string[] = [];
    adapter.keepAlive = async () => {
      order.push("keep");
    };
    adapter.stageFile = async () => {
      order.push("stage");
      return { fileId: "F-staged" };
    };
    const thread = makeThread(adapter);

    await thread.post(mixedUi);

    expect(order).toEqual(["keep", "stage"]);
  });

  it("throws when stageFile is missing and the tree has Render", async () => {
    const adapter = new FakeAdapter();
    const thread = makeThread(adapter);
    await expect(thread.post(mixedUi)).rejects.toThrow(
      /channels.render:.*stageFile/,
    );
    expect(adapter.posted).toHaveLength(0);
  });

  it("throws a validate error before stageFile for Button inside Render", async () => {
    const adapter = new FakeAdapter();
    const stageFile = vi.fn(async () => ({ fileId: "F" }));
    adapter.stageFile = stageFile;
    const thread = makeThread(adapter);

    await expect(
      thread.post(
        <Message>
          <Render alt="x">
            <Button value="no">No</Button>
          </Render>
        </Message>,
      ),
    ).rejects.toThrow(/cannot contain <Button>/);
    expect(stageFile).not.toHaveBeenCalled();
    expect(adapter.posted).toHaveLength(0);
  });

  it("update() of Message+Render calls adapter.update with rewritten IR", async () => {
    const adapter = new FakeAdapter();
    adapter.stageFile = async () => ({ fileId: "F-upd" });
    adapter.postFile = async () => {
      throw new Error("postFile must not run for mixed Render update");
    };
    const thread = makeThread(adapter);

    await thread.update({ id: "m1" }, mixedUi);

    expect(adapter.updated).toHaveLength(1);
    expect(adapter.updated[0]?.ref).toEqual({ id: "m1" });
    const images = collect(adapter.updated[0]!.ir, "image");
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      type: "image",
      props: { alt: "card", fileId: "F-upd" },
    });
    expect(collect(adapter.updated[0]!.ir, "render")).toHaveLength(0);
  });

  it("update() of raw React createElement still throws the arbitrary JSX message", async () => {
    const adapter = new FakeAdapter();
    adapter.stageFile = async () => ({ fileId: "nope" });
    const thread = makeThread(adapter);
    await expect(
      thread.update({ id: "m1" }, createElement("div", null) as never),
    ).rejects.toThrow(/does not support arbitrary JSX/);
    expect(adapter.updated).toHaveLength(0);
  });
});

function collect(nodes: readonly ChannelNode[], type: string): ChannelNode[] {
  const out: ChannelNode[] = [];
  const walk = (n: ChannelNode) => {
    if (n.type === type) out.push(n);
    const raw = n.props.children;
    const kids = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    for (const k of kids) {
      if (typeof k === "object" && k && "type" in k) walk(k as ChannelNode);
    }
  };
  for (const n of nodes) walk(n);
  return out;
}
