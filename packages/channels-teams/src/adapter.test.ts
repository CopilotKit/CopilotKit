import { describe, it, expect } from "vitest";
import { TeamsAdapter, teams } from "./adapter.js";
import { FakeTeamsConnector } from "./testing/fake-teams-connector.js";

/**
 * `TeamsAdapter` is credential-free: it holds no `CloudAdapter`, no HTTP
 * listener, and no `clientId`/`clientSecret`/`tenantId`. Every credentialed
 * operation (ingress ownership, sends, proactive re-entry, Graph reads) now
 * lives behind a runner-injected `TeamsConnector` (see `teams-connector.ts`
 * and `teams-connector.test.ts` for the connector's own ingress/interaction/
 * file-collection/typing coverage, and `make-egress.test.ts` for the
 * declarative `makeEgress` entry point). This file covers the adapter's own
 * responsibilities: the connector-binding contract, pure rendering/decoding,
 * and the thin `PlatformAdapter` methods delegating to the bound connector.
 */

describe("TeamsAdapter connector binding", () => {
  it("throws a clear error when start() runs unbound", async () => {
    const adapter = teams({});
    await expect(adapter.start({} as never)).rejects.toThrow(
      /Teams channel has no connector.*ChannelRunner.*TeamsConnector/s,
    );
  });

  it("throws when an egress method runs unbound", async () => {
    const adapter = teams({});
    await expect(
      adapter.post({ conversationKey: "c", reference: {} }, []),
    ).rejects.toThrow(/Teams channel has no connector/);
  });

  it("stop() on a never-started/unbound adapter is a harmless no-op", async () => {
    const adapter = teams({});
    await expect(adapter.stop()).resolves.toBeUndefined();
  });

  it("start() delegates ingress ownership entirely to the bound connector", async () => {
    const adapter = teams({ files: { maxFiles: 2 } });
    const connector = new FakeTeamsConnector();
    adapter.ɵbindConnector(connector);
    const sink = { onTurn: async () => {} } as never;

    await adapter.start(sink);

    expect(connector.ingressConfig?.sink).toBe(sink);
    expect(connector.ingressConfig?.files).toEqual({ maxFiles: 2 });
    expect(typeof connector.ingressConfig?.recordUser).toBe("function");
  });

  it("stop() delegates to the bound connector's stopIngress", async () => {
    const adapter = teams({});
    const connector = new FakeTeamsConnector();
    adapter.ɵbindConnector(connector);

    await adapter.stop();

    expect(connector.ingressStopped).toBe(true);
  });
});

describe("TeamsAdapter egress delegation (own bound connector)", () => {
  function setup() {
    const adapter = new TeamsAdapter({});
    const connector = new FakeTeamsConnector();
    adapter.ɵbindConnector(connector);
    return { adapter, connector };
  }

  const target = { conversationKey: "conv-1", reference: {} };

  it("post() routes through the bound connector's sendActivity", async () => {
    const { adapter, connector } = setup();

    const ref = await adapter.post(target, [
      {
        type: "section",
        props: { children: [{ type: "text", props: { value: "hi" } }] },
      },
    ]);

    expect(connector.calls[0]!.op).toBe("sendActivity");
    expect((ref as { id: string }).id).toBe("fake-activity-1");
  });

  it("update() is a no-op when the ref carries no id", async () => {
    const { adapter, connector } = setup();

    await adapter.update({ id: "" }, []);

    expect(connector.calls).toHaveLength(0);
  });

  it("delete() routes through the bound connector's deleteActivity", async () => {
    const { adapter, connector } = setup();

    await adapter.delete({ id: "act-1", conversationKey: "conv-1" });

    expect(connector.calls[0]!.op).toBe("deleteActivity");
  });

  it("postFile() routes through the bound connector's sendFile and reports {ok:true}", async () => {
    const { adapter, connector } = setup();

    const res = await adapter.postFile(target, {
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      filename: "chart.png",
      title: "Chart",
      altText: "Sev counts",
    });

    expect(res).toEqual({ ok: true, fileId: "fake-file-1" });
    expect(connector.calls[0]!.op).toBe("sendFile");
  });

  it("postFile() reports {ok:false, error} when the connector's sendFile throws", async () => {
    const { adapter, connector } = setup();
    connector.results.throwing = { sendFile: new Error("no context") };

    const res = await adapter.postFile(target, {
      bytes: new Uint8Array([1]),
      filename: "x.png",
    });

    expect(res).toEqual({ ok: false, error: "no context" });
  });

  it("stream() drives the bound connector's sendActivity/updateActivity", async () => {
    const { adapter, connector } = setup();
    async function* chunks() {
      yield "hello";
    }

    await adapter.stream(target, chunks());

    expect(connector.calls.map((c) => c.op)).toContain("sendActivity");
  });

  it("createRunRenderer() drives the bound connector's sendActivity", async () => {
    const { adapter, connector } = setup();
    const renderer = adapter.createRunRenderer(target);

    await renderer.subscriber.onTextMessageStartEvent!({
      event: { messageId: "m1" },
    } as never);
    renderer.subscriber.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "hi" },
    } as never);
    await renderer.subscriber.onTextMessageEndEvent!({
      event: { messageId: "m1" },
    } as never);

    expect(connector.calls.map((c) => c.op)).toContain("sendActivity");
  });
});

describe("TeamsAdapter rendering / decoding (pure, no connector needed)", () => {
  it("render() collapses a text-only tree to plain text", () => {
    const adapter = new TeamsAdapter({});
    const payload = adapter.render([
      { type: "text", props: { value: "hello" } },
    ]);
    expect(payload).toEqual({ text: expect.stringContaining("hello") });
  });

  it("render() renders structured UI as an Adaptive Card", () => {
    const adapter = new TeamsAdapter({});
    const payload = adapter.render([
      {
        type: "header",
        props: { children: [{ type: "text", props: { value: "hi" } }] },
      },
    ]);
    expect("card" in payload).toBe(true);
  });

  it("decodeInteraction() decodes an Adaptive Card Action.Submit activity", () => {
    const adapter = new TeamsAdapter({});
    const evt = adapter.decodeInteraction({
      value: { ckActionId: "ck:1", value: { x: 1 } },
      conversation: { id: "conv-1" },
      from: { id: "user-1", name: "Sam" },
      replyToId: "act-1",
      getConversationReference: () => ({ conversation: { id: "conv-1" } }),
    });
    expect(evt?.id).toBe("ck:1");
    expect(evt?.value).toEqual({ x: 1 });
  });

  it("decodeInteraction() returns undefined for an ordinary chat activity", () => {
    const adapter = new TeamsAdapter({});
    const evt = adapter.decodeInteraction({
      conversation: { id: "conv-1" },
    });
    expect(evt).toBeUndefined();
  });

  it("lookupUser() is not wired (returns undefined) — no connector needed", async () => {
    const adapter = new TeamsAdapter({});
    await expect(adapter.lookupUser({ query: "ana" })).resolves.toBeUndefined();
  });
});

describe("TeamsAdapter conversation transcript (in-memory, no connector needed)", () => {
  it("getMessages() reads back what the store recorded via recordUser/recordAssistant", async () => {
    const adapter = new TeamsAdapter({});
    adapter.conversationStore; // touch to ensure lazy init doesn't throw
    (
      adapter as unknown as {
        store: { recordUser: (k: string, c: string) => void };
      }
    ).store.recordUser("conv-1", "hi");

    const msgs = await adapter.getMessages({
      conversationKey: "conv-1",
      reference: {},
    });

    expect(msgs).toEqual([{ text: "hi", isBot: false }]);
  });
});
