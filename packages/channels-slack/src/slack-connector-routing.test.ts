import { describe, it, expect } from "vitest";
import { SlackAdapter } from "./adapter.js";
import { FakeSlackConnector } from "./testing/fake-slack-connector.js";
import type { SlackConnector } from "./slack-connector.js";
import type { ChannelNode } from "@copilotkit/channels-ui";
import type { AssistantHandle } from "./assistant.js";

/**
 * Task T3s-1: every credentialed egress operation `SlackAdapter` performs
 * must route through its `SlackConnector` (built internally from tokens) with
 * the right op + args — proven here by injecting a `FakeSlackConnector`
 * directly (bypassing any WebClient-shaped fake entirely).
 */
function makeAdapter() {
  const adapter = new SlackAdapter({ botToken: "x", appToken: "y" });
  const connector = new FakeSlackConnector();
  (
    adapter as unknown as { connectorOverride: SlackConnector }
  ).connectorOverride = connector;
  return { adapter, connector };
}

/** Stub a known assistant-pane thread so `isPaneTarget` (setSuggestedPrompts/setThreadTitle gate) is true. */
function makePaneAdapter() {
  const { adapter, connector } = makeAdapter();
  const handle: AssistantHandle = { isAssistantThread: () => true };
  (adapter as unknown as { assistantHandle: AssistantHandle }).assistantHandle =
    handle;
  return { adapter, connector };
}

const section = (text: string): ChannelNode => ({
  type: "section",
  props: { children: [{ type: "text", props: { value: text } }] },
});

describe("SlackAdapter → SlackConnector routing", () => {
  it("post() routes to connector.postMessage with channel/thread_ts/blocks", async () => {
    const { adapter, connector } = makeAdapter();
    const ref = await adapter.post({ channel: "C1", threadTs: "100.0" }, [
      section("hi"),
    ]);

    expect(connector.calls).toHaveLength(1);
    expect(connector.calls[0]!.op).toBe("postMessage");
    const args = connector.calls[0]!.args as {
      channel: string;
      thread_ts?: string;
      blocks: unknown[];
    };
    expect(args.channel).toBe("C1");
    expect(args.thread_ts).toBe("100.0");
    expect(args.blocks).toHaveLength(1);
    expect(ref.id).toBe("fake-ts-1");
  });

  it("update() routes to connector.updateMessage with channel/ts", async () => {
    const { adapter, connector } = makeAdapter();
    await adapter.update({ id: "200.5", channel: "C1" }, [section("edited")]);

    expect(connector.calls[0]!.op).toBe("updateMessage");
    const args = connector.calls[0]!.args as { channel: string; ts: string };
    expect(args.channel).toBe("C1");
    expect(args.ts).toBe("200.5");
  });

  it("delete() routes to connector.deleteMessage with channel/ts", async () => {
    const { adapter, connector } = makeAdapter();
    await adapter.delete({ id: "200.5", channel: "C1" });

    expect(connector.calls[0]!.op).toBe("deleteMessage");
    expect(connector.calls[0]!.args).toEqual({ channel: "C1", ts: "200.5" });
  });

  it("stream() legacy path routes to postMessage then updateMessage", async () => {
    const { adapter, connector } = makeAdapter();
    (adapter as unknown as { opts: { streaming?: string } }).opts.streaming =
      "legacy";
    async function* chunks() {
      yield "Hello";
      yield " world";
    }
    const ref = await adapter.stream(
      { channel: "C1", threadTs: "100.0" },
      chunks(),
    );

    const ops = connector.calls.map((c) => c.op);
    expect(ops[0]).toBe("postMessage");
    expect(ops.slice(1)).toContain("updateMessage");
    expect(ref.channel).toBe("C1");
  });

  it("stream() native path routes to startStream/appendStream/stopStream", async () => {
    const { adapter, connector } = makeAdapter();
    async function* chunks() {
      yield "Hello";
    }
    const ref = await adapter.stream(
      { channel: "C1", threadTs: "100.0" },
      chunks(),
    );

    const ops = connector.calls.map((c) => c.op);
    expect(ops[0]).toBe("startStream");
    expect(ops).toContain("appendStream");
    expect(ops[ops.length - 1]).toBe("stopStream");
    expect(ref.id).toBe("fake-stream-ts-1");
  });

  it("createRunRenderer legacy path projects renderTransport onto postMessage/updateMessage/setStatus", async () => {
    const { adapter, connector } = makeAdapter();
    (adapter as unknown as { opts: { streaming?: string } }).opts.streaming =
      "legacy";
    const renderer = adapter.createRunRenderer({
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

    const ops = connector.calls.map((c) => c.op);
    // Native status ("is thinking…") anchored to the thread, then the
    // legacy placeholder post/update cadence.
    expect(ops).toContain("setStatus");
    expect(ops).toContain("postMessage");
  });

  it("createRunRenderer native path projects nativeTransport onto startStream/appendStream/stopStream", async () => {
    const { adapter, connector } = makeAdapter();
    const renderer = adapter.createRunRenderer({
      channel: "C1",
      threadTs: "100.0",
    });

    renderer.subscriber.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "hi" },
    } as never);
    await renderer.finish?.();

    const ops = connector.calls.map((c) => c.op);
    expect(ops).toContain("startStream");
    expect(ops).toContain("appendStream");
    expect(ops).toContain("stopStream");
  });

  it("setSuggestedPrompts() routes to connector.setSuggestedPrompts for a pane target", async () => {
    const { adapter, connector } = makePaneAdapter();
    const res = await adapter.setSuggestedPrompts(
      { channel: "C1", threadTs: "100.0" },
      [{ title: "T", message: "M" }],
      { title: "Chips" },
    );

    expect(res).toEqual({ ok: true });
    expect(connector.calls[0]!.op).toBe("setSuggestedPrompts");
    const args = connector.calls[0]!.args as {
      channel_id: string;
      thread_ts: string;
      title?: string;
    };
    expect(args.channel_id).toBe("C1");
    expect(args.thread_ts).toBe("100.0");
    expect(args.title).toBe("Chips");
  });

  it("setThreadTitle() routes to connector.setThreadTitle for a pane target", async () => {
    const { adapter, connector } = makePaneAdapter();
    const res = await adapter.setThreadTitle(
      { channel: "C1", threadTs: "100.0" },
      "New title",
    );

    expect(res).toEqual({ ok: true });
    expect(connector.calls[0]!.op).toBe("setThreadTitle");
    expect(connector.calls[0]!.args).toEqual({
      channel_id: "C1",
      thread_ts: "100.0",
      title: "New title",
    });
  });

  it("lookupUser() routes to connector.listUsers with cursor/limit", async () => {
    const { adapter, connector } = makeAdapter();
    connector.results.listUsers = {
      members: [{ id: "U1", name: "ana", real_name: "Ana Smith" }],
    };

    const u = await adapter.lookupUser({ query: "ana" });

    expect(connector.calls[0]!.op).toBe("listUsers");
    expect(connector.calls[0]!.args).toEqual({ cursor: undefined, limit: 200 });
    expect(u).toEqual({
      id: "U1",
      name: "Ana Smith",
      handle: "ana",
      email: undefined,
    });
  });

  it("resolveUser() routes to connector.getUserInfo", async () => {
    const { adapter, connector } = makeAdapter();
    connector.results.getUserInfo = {
      user: { id: "U1", real_name: "Ana Smith" },
    };

    const u = await adapter.resolveUser("U1");

    expect(connector.calls[0]!.op).toBe("getUserInfo");
    expect(connector.calls[0]!.args).toEqual({ user: "U1" });
    expect(u.name).toBe("Ana Smith");
  });

  it("getMessages() routes to connector.getReplies with channel/ts/limit", async () => {
    const { adapter, connector } = makeAdapter();
    connector.results.getReplies = {
      messages: [{ ts: "100.0", text: "hi", user: "U1" }],
    };

    const msgs = await adapter.getMessages({
      channel: "C1",
      threadTs: "100.0",
    });

    expect(connector.calls[0]!.op).toBe("getReplies");
    expect(connector.calls[0]!.args).toEqual({
      channel: "C1",
      ts: "100.0",
      limit: 100,
    });
    expect(msgs).toHaveLength(1);
  });

  it("postFile() routes to connector.uploadFile with channel_id/file/thread_ts", async () => {
    const { adapter, connector } = makeAdapter();
    const res = await adapter.postFile(
      { channel: "C1", threadTs: "100.0" },
      { bytes: new Uint8Array([1, 2, 3]), filename: "x.png" },
    );

    expect(res).toEqual({ ok: true });
    expect(connector.calls[0]!.op).toBe("uploadFile");
    const args = connector.calls[0]!.args as {
      channel_id: string;
      thread_ts?: string;
      filename: string;
    };
    expect(args.channel_id).toBe("C1");
    expect(args.thread_ts).toBe("100.0");
    expect(args.filename).toBe("x.png");
  });

  it("addReaction()/removeReaction() route to connector.addReaction/removeReaction", async () => {
    const { adapter, connector } = makeAdapter();
    await adapter.addReaction({ channel: "C1" }, { id: "100.0" }, "thumbsup");
    await adapter.removeReaction(
      { channel: "C1" },
      { id: "100.0" },
      "thumbsup",
    );

    expect(connector.calls.map((c) => c.op)).toEqual([
      "addReaction",
      "removeReaction",
    ]);
    expect(connector.calls[0]!.args).toMatchObject({
      channel: "C1",
      timestamp: "100.0",
    });
  });

  it("postEphemeral() routes to connector.postEphemeral with channel/user/blocks", async () => {
    const { adapter, connector } = makeAdapter();
    const res = await adapter.postEphemeral(
      { channel: "C1", threadTs: "100.0" },
      "U1",
      [section("shh")],
      { fallbackToDM: false },
    );

    expect(connector.calls[0]!.op).toBe("postEphemeral");
    const args = connector.calls[0]!.args as {
      channel: string;
      user: string;
      thread_ts?: string;
    };
    expect(args.channel).toBe("C1");
    expect(args.user).toBe("U1");
    expect(args.thread_ts).toBe("100.0");
    expect(res?.ok).toBe(true);
  });

  it("openModal() routes to connector.openModal with trigger_id/view", async () => {
    const { adapter, connector } = makeAdapter();
    const res = await adapter.openModal({ channel: "C1" }, "trigger-1", [
      { type: "modal", props: { children: [] } },
    ]);

    expect(res).toEqual({ ok: true });
    expect(connector.calls[0]!.op).toBe("openModal");
    const args = connector.calls[0]!.args as { trigger_id: string };
    expect(args.trigger_id).toBe("trigger-1");
  });
});
