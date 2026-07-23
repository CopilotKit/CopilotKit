import { describe, it, expect } from "vitest";
import { DirectAdapterEgress } from "./channel-egress.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import type { ChannelNode } from "@copilotkit/channels-ui";

const ir: ChannelNode[] = [{ type: "text", props: { value: "hi" } }];
const target = { channel: "c1" };

describe("DirectAdapterEgress", () => {
  it("post → adapter.post, returning its ref", async () => {
    const a = new FakeAdapter();
    const egress = new DirectAdapterEgress(a);
    const ref = await egress.send({ op: "post", target, ir });
    expect(ref.id).toBe("msg-1");
    expect(a.posted).toEqual([ir]);
  });

  it("update → adapter.update, echoing the ref", async () => {
    const a = new FakeAdapter();
    const egress = new DirectAdapterEgress(a);
    const ref = await egress.send({ op: "update", ref: { id: "m9" }, ir });
    expect(ref).toEqual({ id: "m9" });
    expect(a.updated).toEqual([{ ref: { id: "m9" }, ir }]);
  });

  it("delete → adapter.delete", async () => {
    const a = new FakeAdapter();
    const egress = new DirectAdapterEgress(a);
    await expect(
      egress.send({ op: "delete", ref: { id: "m1" } }),
    ).resolves.toBeUndefined();
  });

  it("react add/remove → addReaction/removeReaction", async () => {
    const a = new FakeAdapter();
    const egress = new DirectAdapterEgress(a);
    await egress.send({
      op: "react",
      target,
      ref: { id: "m1" },
      emoji: "eyes",
      add: true,
    });
    await egress.send({
      op: "react",
      target,
      ref: { id: "m1" },
      emoji: "eyes",
      add: false,
    });
    expect(a.reactionsAdded).toEqual([{ ref: { id: "m1" }, emoji: "eyes" }]);
    expect(a.reactionsRemoved).toEqual([{ ref: { id: "m1" }, emoji: "eyes" }]);
  });

  it("react on a surface without reactions → capability-gated error", async () => {
    const a = new FakeAdapter({ reactions: false });
    const egress = new DirectAdapterEgress(a);
    const r = await egress.send({
      op: "react",
      target,
      ref: { id: "m1" },
      emoji: "eyes",
      add: true,
    });
    expect(r).toEqual({ ok: false, error: "fake does not support reactions" });
  });

  it("ephemeral → adapter.postEphemeral (native)", async () => {
    const a = new FakeAdapter({ nativeEphemeral: true });
    const egress = new DirectAdapterEgress(a);
    const r = await egress.send({
      op: "ephemeral",
      target,
      user: "u1",
      ir,
      fallbackToDM: false,
    });
    expect(r).toEqual({ ok: true, usedFallback: false, ref: { id: "eph-1" } });
    expect(a.ephemeralPosts).toEqual([
      { user: "u1", ir, opts: { fallbackToDM: false } },
    ]);
  });

  it("file → adapter.postFile; absent → capability-gated error", async () => {
    const a = new FakeAdapter();
    const egress = new DirectAdapterEgress(a);
    // FakeAdapter has no postFile → capability-gated.
    const r = await egress.send({
      op: "file",
      target,
      file: { bytes: new Uint8Array([1]), filename: "a.txt" },
    });
    expect(r).toEqual({
      ok: false,
      error: "fake does not support file upload",
    });
  });

  it("suggested → adapter.setSuggestedPrompts (passing opts only when a title is set)", async () => {
    const a = new FakeAdapter();
    const egress = new DirectAdapterEgress(a);
    await egress.send({
      op: "suggested",
      target,
      prompts: [{ title: "t", message: "m" }],
    });
    expect(a.suggestedPromptsCalls).toEqual([
      { target, prompts: [{ title: "t", message: "m" }], opts: undefined },
    ]);
    await egress.send({
      op: "suggested",
      target,
      prompts: [{ title: "t", message: "m" }],
      title: "Convo",
    });
    expect(a.suggestedPromptsCalls[1]!.opts).toEqual({ title: "Convo" });
  });

  it("suggested on a surface without the pane methods → capability-gated error", async () => {
    const a = new FakeAdapter({ paneMethods: false });
    const egress = new DirectAdapterEgress(a);
    const r = await egress.send({ op: "suggested", target, prompts: [] });
    expect(r).toEqual({
      ok: false,
      error: "fake does not support suggested prompts",
    });
  });

  it("title → adapter.setThreadTitle; absent → capability-gated error", async () => {
    const a = new FakeAdapter();
    const egress = new DirectAdapterEgress(a);
    await egress.send({ op: "title", target, title: "Hello" });
    expect(a.threadTitleCalls).toEqual([{ target, title: "Hello" }]);

    const b = new FakeAdapter({ paneMethods: false });
    const r = await new DirectAdapterEgress(b).send({
      op: "title",
      target,
      title: "x",
    });
    expect(r).toEqual({
      ok: false,
      error: "fake does not support thread titles",
    });
  });

  it("stream / createRunRenderer / getMessages / lookupUser delegate to the adapter", async () => {
    const a = new FakeAdapter();
    a.user = { id: "u1", name: "User One" };
    a.messages = [{ text: "prior" }];
    const egress = new DirectAdapterEgress(a);

    async function* chunks() {
      yield "he";
      yield "llo";
    }
    const ref = await egress.stream(target, chunks());
    expect(ref.id).toBe("msg-1");
    expect(a.posted).toEqual([[{ type: "text", props: { value: "hello" } }]]);

    const r = egress.createRunRenderer(target);
    expect(r).toBe(a.lastRunRenderer);

    expect(await egress.getMessages(target)).toEqual([{ text: "prior" }]);
    expect(await egress.lookupUser({ query: "u1" })).toEqual({
      id: "u1",
      name: "User One",
    });
  });
});
