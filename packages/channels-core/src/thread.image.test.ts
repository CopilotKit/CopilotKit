import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { Message } from "@copilotkit/channels-ui";
import { Thread } from "./thread.js";
import type { ThreadDeps } from "./thread.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { ActionRegistry } from "./action-registry.js";
import { MemoryStore } from "./state/memory-store.js";
import { kvActionStore } from "./state/kv-action-store.js";

function makeThread(
  adapter: FakeAdapter,
  renderImage: ThreadDeps["renderImage"],
) {
  const store = new MemoryStore();
  const deps: ThreadDeps = {
    adapter,
    replyTarget: {},
    conversationKey: "c",
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
    render: {
      fonts: [{ name: "TestFont", data: new Uint8Array([9, 9, 9]) }],
      stylesheets: ["body { color: red; }"],
      width: 640,
      height: 400,
    },
    renderImage,
  };
  return new Thread(deps);
}

describe("Thread.post image routing", () => {
  it("renders a React element to an image and uploads it via postFile", async () => {
    const adapter = new FakeAdapter();
    const filePosts: unknown[] = [];
    adapter.postFile = async (_t, args) => {
      filePosts.push(args);
      return { ok: true, fileId: "F1" };
    };
    const renderImage = vi.fn(
      async (_node: unknown, _cfg: unknown) => new Uint8Array([1, 2, 3]),
    );
    const thread = makeThread(adapter, renderImage);

    const ref = await thread.post(createElement("div", null, "hi") as never, {
      filename: "card.png",
      width: 800,
    });

    expect(renderImage).toHaveBeenCalledTimes(1);
    expect(renderImage.mock.calls[0]![1]).toMatchObject({
      width: 800,
      height: 400,
    }); // per-post width overrides
    // fonts/stylesheets are not overridden per-post, so they thread through
    // from the thread-wide deps.render config.
    expect(renderImage.mock.calls[0]![1]).toMatchObject({
      fonts: [{ name: "TestFont", data: new Uint8Array([9, 9, 9]) }],
      stylesheets: ["body { color: red; }"],
    });
    expect(filePosts).toHaveLength(1);
    expect(filePosts[0]).toMatchObject({ filename: "card.png" });
    expect(adapter.posted).toHaveLength(0); // did NOT go through the native IR path
    expect(ref.id).toBe("F1");
  });

  it("keeps a branded channel component on the native path", async () => {
    const adapter = new FakeAdapter();
    const renderImage = vi.fn(async () => new Uint8Array());
    const thread = makeThread(adapter, renderImage);

    await thread.post({ type: Message, props: { children: "hello" } } as never);

    expect(renderImage).not.toHaveBeenCalled();
    expect(adapter.posted).toHaveLength(1);
  });

  it("throws when the image upload is rejected", async () => {
    const adapter = new FakeAdapter();
    adapter.postFile = async () => ({ ok: false, error: "nope" });
    const thread = makeThread(
      adapter,
      vi.fn(async () => new Uint8Array([1])),
    );
    await expect(
      thread.post(createElement("div", null) as never),
    ).rejects.toThrow(/nope/);
  });

  it("throws on arbitrary JSX passed to update()", async () => {
    const adapter = new FakeAdapter();
    const thread = makeThread(
      adapter,
      vi.fn(async () => new Uint8Array()),
    );
    await expect(
      thread.update({ id: "m1" }, createElement("div", null) as never),
    ).rejects.toThrow(/does not support arbitrary JSX/);
  });

  it("throws on arbitrary JSX passed to awaitChoice()", async () => {
    const adapter = new FakeAdapter();
    const thread = makeThread(
      adapter,
      vi.fn(async () => new Uint8Array()),
    );
    await expect(
      thread.awaitChoice(createElement("div", null) as never),
    ).rejects.toThrow(/does not support arbitrary JSX/);
  });
});
