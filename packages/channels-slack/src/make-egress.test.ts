import { describe, it, expect } from "vitest";
import { SlackAdapter } from "./adapter.js";
import { FakeSlackConnector } from "./testing/fake-slack-connector.js";
import type { SlackConnector } from "./slack-connector.js";
import type { ChannelNode } from "@copilotkit/channels-ui";
import type { AssistantHandle } from "./assistant.js";

/**
 * Task T3s-2: `SlackAdapter.makeEgress(connector)` is a SECOND entry point
 * onto the SAME effect→native mapping the `PlatformAdapter` methods use (see
 * slack-connector-routing.test.ts) — routed through a RUNNER-supplied
 * connector instead of the adapter's own `this.connector`. Every test here
 * injects a connector distinct from the adapter's own (`connectorOverride`)
 * and asserts calls land ONLY on the injected one.
 */
function makeAdapter() {
  const adapter = new SlackAdapter({ botToken: "x", appToken: "y" });
  // The adapter's OWN connector — must receive ZERO calls when driving
  // effects through `makeEgress`'s injected connector instead.
  const ownConnector = new FakeSlackConnector();
  (
    adapter as unknown as { connectorOverride: SlackConnector }
  ).connectorOverride = ownConnector;
  const injected = new FakeSlackConnector();
  return { adapter, ownConnector, injected };
}

/** Stub a known assistant-pane thread so suggested/title ops pass their gate. */
function makePaneAdapter() {
  const { adapter, ownConnector, injected } = makeAdapter();
  const handle: AssistantHandle = { isAssistantThread: () => true };
  (adapter as unknown as { assistantHandle: AssistantHandle }).assistantHandle =
    handle;
  return { adapter, ownConnector, injected };
}

const section = (text: string): ChannelNode => ({
  type: "section",
  props: { children: [{ type: "text", props: { value: text } }] },
});

describe("SlackAdapter.makeEgress", () => {
  it("send({op:'post'}) routes to the injected connector's postMessage, not the adapter's own", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const ref = await egress.send({
      op: "post",
      target: { channel: "C1", threadTs: "100.0" },
      ir: [section("hi")],
    });

    expect(injected.calls).toHaveLength(1);
    expect(injected.calls[0]!.op).toBe("postMessage");
    expect(ownConnector.calls).toHaveLength(0);
    const args = injected.calls[0]!.args as {
      channel: string;
      blocks: unknown[];
    };
    expect(args.channel).toBe("C1");
    expect(args.blocks).toHaveLength(1);
    expect(ref.id).toBe("fake-ts-1");
  });

  it("send({op:'update'}) routes to the injected connector's updateMessage", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const ref = await egress.send({
      op: "update",
      ref: { id: "200.5", channel: "C1" },
      ir: [section("edited")],
    });

    expect(injected.calls[0]!.op).toBe("updateMessage");
    expect(ownConnector.calls).toHaveLength(0);
    expect(ref).toEqual({ id: "200.5", channel: "C1" });
  });

  it("send({op:'delete'}) routes to the injected connector's deleteMessage", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    await egress.send({ op: "delete", ref: { id: "200.5", channel: "C1" } });

    expect(injected.calls[0]!.op).toBe("deleteMessage");
    expect(injected.calls[0]!.args).toEqual({ channel: "C1", ts: "200.5" });
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'react', add:true}) routes to the injected connector's addReaction", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "react",
      target: { channel: "C1" },
      ref: { id: "100.0" },
      emoji: "thumbsup",
      add: true,
    });

    expect(res).toEqual({ ok: true });
    expect(injected.calls[0]!.op).toBe("addReaction");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'react', add:false}) routes to the injected connector's removeReaction", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "react",
      target: { channel: "C1" },
      ref: { id: "100.0" },
      emoji: "thumbsup",
      add: false,
    });

    expect(res).toEqual({ ok: true });
    expect(injected.calls[0]!.op).toBe("removeReaction");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'react'}) surfaces the injected connector's error as {ok:false, error}", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    injected.results.throwing = { addReaction: new Error("rate limited") };
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "react",
      target: { channel: "C1" },
      ref: { id: "100.0" },
      emoji: "thumbsup",
      add: true,
    });

    expect(res).toEqual({ ok: false, error: "rate limited" });
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'ephemeral'}) routes to the injected connector's postEphemeral", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "ephemeral",
      target: { channel: "C1", threadTs: "100.0" },
      user: "U1",
      ir: [section("shh")],
      fallbackToDM: false,
    });

    expect(injected.calls[0]!.op).toBe("postEphemeral");
    expect(ownConnector.calls).toHaveLength(0);
    expect(res?.ok).toBe(true);
  });

  it("send({op:'file'}) routes to the injected connector's uploadFile", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "file",
      target: { channel: "C1" },
      file: { bytes: new Uint8Array([1, 2, 3]), filename: "x.png" },
    });

    expect(res).toEqual({ ok: true });
    expect(injected.calls[0]!.op).toBe("uploadFile");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'suggested'}) routes to the injected connector's setSuggestedPrompts for a pane target", async () => {
    const { adapter, ownConnector, injected } = makePaneAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "suggested",
      target: { channel: "C1", threadTs: "100.0" },
      prompts: [{ title: "T", message: "M" }],
      title: "Chips",
    });

    expect(res).toEqual({ ok: true });
    expect(injected.calls[0]!.op).toBe("setSuggestedPrompts");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'suggested'}) on a non-pane target returns {ok:false} without touching either connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "suggested",
      target: { channel: "C1" },
      prompts: [{ title: "T", message: "M" }],
    });

    expect(res.ok).toBe(false);
    expect(injected.calls).toHaveLength(0);
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("send({op:'title'}) routes to the injected connector's setThreadTitle for a pane target", async () => {
    const { adapter, ownConnector, injected } = makePaneAdapter();
    const egress = adapter.makeEgress(injected);

    const res = await egress.send({
      op: "title",
      target: { channel: "C1", threadTs: "100.0" },
      title: "New title",
    });

    expect(res).toEqual({ ok: true });
    expect(injected.calls[0]!.op).toBe("setThreadTitle");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("stream() legacy path drives the injected connector's postMessage/updateMessage", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    (adapter as unknown as { opts: { streaming?: string } }).opts.streaming =
      "legacy";
    const egress = adapter.makeEgress(injected);
    async function* chunks() {
      yield "Hello";
      yield " world";
    }

    const ref = await egress.stream(
      { channel: "C1", threadTs: "100.0" },
      chunks(),
    );

    const ops = injected.calls.map((c) => c.op);
    expect(ops[0]).toBe("postMessage");
    expect(ops.slice(1)).toContain("updateMessage");
    expect(ref.channel).toBe("C1");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("stream() native path drives the injected connector's startStream/appendStream/stopStream", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);
    async function* chunks() {
      yield "Hello";
    }

    const ref = await egress.stream(
      { channel: "C1", threadTs: "100.0" },
      chunks(),
    );

    const ops = injected.calls.map((c) => c.op);
    expect(ops[0]).toBe("startStream");
    expect(ops).toContain("appendStream");
    expect(ops[ops.length - 1]).toBe("stopStream");
    expect(ref.id).toBe("fake-stream-ts-1");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("createRunRenderer() legacy path projects the transport onto the injected connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    (adapter as unknown as { opts: { streaming?: string } }).opts.streaming =
      "legacy";
    const egress = adapter.makeEgress(injected);
    const renderer = egress.createRunRenderer({
      channel: "C1",
      threadTs: "100.0",
    });

    await renderer.subscriber.onTextMessageStartEvent!({
      event: { messageId: "m1" },
    } as never);
    renderer.subscriber.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "hi" },
    } as never);
    await renderer.subscriber.onTextMessageEndEvent!({
      event: { messageId: "m1" },
    } as never);
    await renderer.finish?.();

    const ops = injected.calls.map((c) => c.op);
    expect(ops).toContain("setStatus");
    expect(ops).toContain("postMessage");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("createRunRenderer() native path projects the transport onto the injected connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    const egress = adapter.makeEgress(injected);
    const renderer = egress.createRunRenderer({
      channel: "C1",
      threadTs: "100.0",
    });

    renderer.subscriber.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "hi" },
    } as never);
    await renderer.finish?.();

    const ops = injected.calls.map((c) => c.op);
    expect(ops).toContain("startStream");
    expect(ops).toContain("appendStream");
    expect(ops).toContain("stopStream");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("getMessages() routes reads AND user enrichment to the injected connector", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    injected.results.getReplies = {
      messages: [{ ts: "100.0", text: "hi", user: "U1" }],
    };
    injected.results.getUserInfo = {
      user: { id: "U1", real_name: "Ana Smith" },
    };
    const egress = adapter.makeEgress(injected);

    const msgs = await egress.getMessages!({
      channel: "C1",
      threadTs: "100.0",
    });

    const ops = injected.calls.map((c) => c.op);
    expect(ops).toContain("getReplies");
    // User enrichment for the returned message must ALSO go through the
    // injected connector, never fall through to the adapter's own.
    expect(ops).toContain("getUserInfo");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.user?.name).toBe("Ana Smith");
    expect(ownConnector.calls).toHaveLength(0);
  });

  it("lookupUser() routes to the injected connector's listUsers", async () => {
    const { adapter, ownConnector, injected } = makeAdapter();
    injected.results.listUsers = {
      members: [{ id: "U1", name: "ana", real_name: "Ana Smith" }],
    };
    const egress = adapter.makeEgress(injected);

    const u = await egress.lookupUser!({ query: "ana" });

    expect(injected.calls[0]!.op).toBe("listUsers");
    expect(u?.name).toBe("Ana Smith");
    expect(ownConnector.calls).toHaveLength(0);
  });
});
