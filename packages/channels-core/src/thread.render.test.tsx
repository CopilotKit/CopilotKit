/** @jsxImportSource @copilotkit/channels-ui */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { Message, Header, Render, Button } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { Thread } from "./thread.js";
import type { ThreadDeps } from "./thread.js";
import type { ResolvedRenderConfig } from "./render/config.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { ActionRegistry } from "./action-registry.js";
import { MemoryStore } from "./state/memory-store.js";
import { kvActionStore } from "./state/kv-action-store.js";

function makeThread(
  adapter: FakeAdapter,
  renderImage: ThreadDeps["renderImage"] = async () =>
    new Uint8Array([1, 2, 3]),
  render: ThreadDeps["render"] = {},
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
    registerWaiter: () => () => {},
    reserveChoiceControls: () => () => {},
    interruptHandlers: new Map(),
    state: store,
    user: null,
    actor: { id: "actor", kind: "unknown" },
    renderImage,
    render,
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
  it.each([{}, { width: 760 }])(
    "shares image defaults and URL policy with standalone posts: %j",
    async (render) => {
      const adapter = new FakeAdapter();
      adapter.stageFile = async () => ({ fileId: "F-staged" });
      adapter.postFile = async () => ({ ok: true, messageId: "m1" });
      const renderImage = vi.fn(
        async (_node: unknown, _cfg: ResolvedRenderConfig) =>
          new Uint8Array([1]),
      );
      const thread = makeThread(adapter, renderImage, render);
      await thread.post(mixedUi);
      await thread.post(<div>Standalone</div>);

      for (const [, config] of renderImage.mock.calls) {
        expect(config).toMatchObject({
          width: render.width ?? 720,
          height: 480,
        });
        expect(
          config.allowImageUrl("https://public-looking.example/image.png"),
        ).toBe(false);
      }
      expect(renderImage).toHaveBeenCalledTimes(2);
    },
  );

  it("forwards an explicit trusted URL policy to both image paths", async () => {
    const adapter = new FakeAdapter();
    adapter.stageFile = async () => ({ fileId: "F-staged" });
    adapter.postFile = async () => ({ ok: true, messageId: "m1" });
    const allowImageUrl = (url: string) =>
      new URL(url).origin === "https://cdn.example.com";
    const renderImage = vi.fn(
      async (_node: unknown, _cfg: ResolvedRenderConfig) => new Uint8Array([1]),
    );
    const thread = makeThread(adapter, renderImage, { allowImageUrl });
    await thread.post(mixedUi);
    await thread.post(<div>Standalone</div>);

    expect(renderImage).toHaveBeenCalledTimes(2);
    for (const [, config] of renderImage.mock.calls) {
      expect(config.allowImageUrl).toBe(allowImageUrl);
    }
  });

  it.each([
    <Render alt="preview">
      <div>Preview</div>
    </Render>,
    mixedUi,
  ])(
    "rejects snapshots in ephemeral messages without dropping content",
    async (ui) => {
      const adapter = new FakeAdapter();
      const postEphemeral = vi.spyOn(adapter, "postEphemeral");
      const stageFile = vi.fn(async () => ({ fileId: "F-staged" }));
      adapter.stageFile = stageFile;
      const renderImage = vi.fn(async () => new Uint8Array([1]));
      const thread = makeThread(adapter, renderImage);
      await expect(
        thread.postEphemeral("u1", ui, { fallbackToDM: true }),
      ).rejects.toThrow(/does not support <Render>/);
      expect(postEphemeral).not.toHaveBeenCalled();
      expect(stageFile).not.toHaveBeenCalled();
      expect(renderImage).not.toHaveBeenCalled();

      await thread.postEphemeral(
        "u1",
        <Message>
          <Header>Native</Header>
        </Message>,
        { fallbackToDM: true },
      );
      expect(postEphemeral).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects nested host markup instead of silently dropping it", async () => {
    const adapter = new FakeAdapter();
    await expect(
      makeThread(adapter).post(
        <Message>
          <div>Preview</div>
        </Message>,
      ),
    ).rejects.toThrow(/Wrap image JSX in <Render>/);
    expect(adapter.posted).toHaveLength(0);
  });
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

  it("does not bind application callbacks inside a snapshot", async () => {
    const adapter = new FakeAdapter();
    adapter.stageFile = async () => ({ fileId: "F-staged" });
    const onClick = vi.fn();
    const snapshot = createElement("button", { onClick }, "Preview");
    const renderImage = vi.fn(
      async (_node: unknown, _cfg: unknown) => new Uint8Array([1]),
    );
    await makeThread(adapter, renderImage).post(
      <Render alt="preview">{snapshot as never}</Render>,
    );
    expect(renderImage.mock.calls[0]?.[0]).toBe(snapshot);
    expect(snapshot.props.onClick).toBe(onClick);
    expect(onClick).not.toHaveBeenCalled();
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

describe("awaitChoice with a <Render> snapshot", () => {
  it("leaves the snapshot's authored elements alone and posts the picker", async () => {
    const adapter = new FakeAdapter();
    adapter.stageFile = async () => ({ fileId: "F-staged" });
    const thread = makeThread(adapter);
    // An HTML <button> inside a snapshot is part of the image, not a picker
    // control. React freezes an element's props in development.
    const element = createElement("button", null, "Looks like a button");
    // <Render> takes host elements at runtime; its JSX type admits only IR.
    const htmlButton = element as unknown as ChannelNode;
    expect(Object.isFrozen(element.props)).toBe(true);
    let error: unknown;
    void thread
      .awaitChoice(
        <Message>
          <Render alt="preview">{htmlButton}</Render>
          <Button value="ok">OK</Button>
        </Message>,
      )
      .catch((err: unknown) => {
        error = err;
      });
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    expect(error).toBeUndefined();
    expect(adapter.posted).toHaveLength(1);
    expect("onClick" in element.props).toBe(false);
  });
});
