import { describe, it, expect } from "vitest";
import { TeamsAdapter } from "./adapter.js";
import { FakeTeamsConnector } from "./testing/fake-teams-connector.js";
import type { ChannelNode } from "@copilotkit/channels-ui";

/**
 * `TeamsAdapter.makeEgress(connector)` is a SECOND entry point onto the SAME
 * effect→native mapping the `PlatformAdapter` methods use, routed through a
 * RUNNER-supplied connector instead of the adapter's own bound one. Every
 * test here injects a connector distinct from the adapter's own bound
 * connector (via `ɵbindConnector`) and asserts calls land ONLY on the
 * injected one.
 */
function makeAdapter() {
  const adapter = new TeamsAdapter({});
  // The adapter's OWN bound connector — must receive ZERO calls when driving
  // effects through `makeEgress`'s injected connector instead.
  const ownConnector = new FakeTeamsConnector();
  adapter.ɵbindConnector(ownConnector);
  const injected = new FakeTeamsConnector();
  return { adapter, ownConnector, injected };
}

const section = (text: string): ChannelNode => ({
  type: "section",
  props: { children: [{ type: "text", props: { value: text } }] },
});

const target = { conversationKey: "conv-1", reference: {} };

describe("TeamsAdapter.makeEgress", () => {
  it("send({op:'post'}) routes to the injected connector's sendActivity, not the adapter's own", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const ref = await egress.send({
      op: "post",
      target,
      ir: [section("hi")],
    });

    expect(injected.calls).toHaveLength(1);
    expect(injected.calls[0]!.op).toBe("sendActivity");
    expect(ownConnector.calls).toHaveLength(0);
    expect(
      (ref as unknown as { conversationKey: string }).conversationKey,
    ).toBe("conv-1");
    expect((ref as { id: string }).id).toBe("fake-activity-1");
  });

  it("send({op:'post'}) renders plain text for a text-only tree", async () => {
    const { adapter, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    await egress.send({ op: "post", target, ir: [section("hello world")] });

    const call = injected.calls[0]!;
    expect(call.op).toBe("sendActivity");
    if (call.op === "sendActivity") {
      expect(call.payload).toEqual({
        text: expect.stringContaining("hello world"),
      });
    }
  });

  it("send({op:'update'}) routes to the injected connector's updateActivity", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    await egress.send({
      op: "update",
      ref: { id: "act-1", conversationKey: "conv-1", reference: {} },
      ir: [section("edited")],
    });

    expect(injected.calls[0]!.op).toBe("updateActivity");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'update'}) is a no-op when the ref has no id", async () => {
    const { adapter, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    await egress.send({
      op: "update",
      ref: { id: "", conversationKey: "conv-1" },
      ir: [section("edited")],
    });

    expect(injected.calls).toHaveLength(0);
  });

  it("send({op:'delete'}) routes to the injected connector's deleteActivity", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    await egress.send({
      op: "delete",
      ref: { id: "act-1", conversationKey: "conv-1" },
    });

    expect(injected.calls[0]!.op).toBe("deleteActivity");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'react'}) reports unsupported without touching either connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "react",
      target,
      ref: { id: "act-1" },
      emoji: "thumbsup",
      add: true,
    });

    expect(res).toEqual({
      ok: false,
      error: "teams does not support reactions",
    });
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'ephemeral'}) reports unsupported without touching either connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "ephemeral",
      target,
      user: "user-1",
      ir: [section("shh")],
      fallbackToDM: false,
    });

    expect(res).toEqual({
      ok: false,
      error: "teams does not support ephemeral messages",
    });
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'suggested'}) reports unsupported without touching either connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "suggested",
      target,
      prompts: [{ title: "T", message: "M" }],
    });

    expect(res).toEqual({
      ok: false,
      error: "teams does not support suggested prompts",
    });
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'title'}) reports unsupported without touching either connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({ op: "title", target, title: "New title" });

    expect(res).toEqual({
      ok: false,
      error: "teams does not support thread titles",
    });
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'file'}) routes to the injected connector's sendFile", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "file",
      target,
      file: { bytes: new Uint8Array([1, 2, 3]), filename: "x.png" },
    });

    expect(res).toEqual({ ok: true, fileId: "fake-file-1" });
    expect(injected.calls[0]!.op).toBe("sendFile");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'file'}) surfaces the injected connector's error as {ok:false, error}", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    injected.results.throwing = { sendFile: new Error("no context") };
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "file",
      target,
      file: { bytes: new Uint8Array([1]), filename: "x.png" },
    });

    expect(res).toEqual({ ok: false, error: "no context" });
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("stream() drives the injected connector's sendActivity/updateActivity", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);
    async function* chunks() {
      yield "Hello";
      yield " world";
    }

    const ref = await egress.stream(target, chunks());

    // TeamsMessageStream throttles flushes (700ms); two chunks arriving
    // synchronously (no real delay) collapse into a single final post at
    // `finish()` — fire the typing indicator once, then post the whole buffer.
    const ops = injected.calls.map((c) => c.op);
    expect(ops).toEqual(["sendTyping", "sendActivity"]);
    expect(
      (ref as unknown as { conversationKey: string }).conversationKey,
    ).toBe("conv-1");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("createRunRenderer() drives the injected connector's sendActivity/updateActivity/typing", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);
    const renderer = egress.createRunRenderer(target);

    await renderer.subscriber.onTextMessageStartEvent!({
      event: { messageId: "m1" },
    } as never);
    renderer.subscriber.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "hi" },
    } as never);
    await renderer.subscriber.onTextMessageEndEvent!({
      event: { messageId: "m1" },
    } as never);

    const ops = injected.calls.map((c) => c.op);
    expect(ops).toContain("sendActivity");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("getMessages()/lookupUser() do NOT need the connector (in-memory store / unwired directory)", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const msgs = await egress.getMessages!(target);
    const user = await egress.lookupUser!({ query: "ana" });

    expect(msgs).toEqual([]);
    expect(user).toBeUndefined();
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });
});
