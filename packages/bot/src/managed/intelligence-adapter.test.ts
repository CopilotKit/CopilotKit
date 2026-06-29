import { describe, it, expect } from "vitest";
import { createBot } from "../create-bot.js";
import { FakeAdapter } from "../testing/fake-adapter.js";
import { FakeAgent } from "../testing/fake-agent.js";
import { Section } from "@copilotkit/bot-ui";
import type { IncomingMessage } from "@copilotkit/bot-ui";
import type { ReplyTarget } from "../platform-adapter.js";
import { intelligenceAdapter } from "./intelligence-adapter.js";
import {
  InMemoryDeliverySource,
  InMemoryEgressSink,
} from "./in-memory-transports.js";
import type {
  ManagedIngressEnvelope,
  ManagedIngressBase,
} from "./contracts.js";

type TurnEnvelope = Extract<ManagedIngressEnvelope, { kind: "turn" }>;
function envelope(partial?: Partial<TurnEnvelope>): ManagedIngressEnvelope {
  return {
    deliveryId: "d1",
    eventId: "e1",
    turnId: "t1",
    botName: "support",
    platform: "slack",
    conversationKey: "c1",
    kind: "turn",
    text: "hello",
    route: { r: 1 },
    ...partial,
  };
}

describe("intelligenceAdapter — ingress dispatch", () => {
  it("dispatches a managed turn to the handler and emits a post egress op", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const bot = createBot({
      adapters: [intelligenceAdapter({ source, egress })],
      agent: () => new FakeAgent(),
    });
    let seen: IncomingMessage | undefined;
    bot.onMessage(async ({ thread, message }) => {
      seen = message;
      await thread.post(Section({ children: "reply" }));
    });
    await bot.start();
    await source.deliver(envelope({ turnId: "t1", eventId: "e1" }));

    expect(egress.ops).toHaveLength(1);
    expect(egress.ops[0]!.op.kind).toBe("post");
    expect(egress.ops[0]!.turnId).toBe("t1");
    expect(seen?.turnId).toBe("t1");
    expect(seen?.deliveryId).toBe("d1");
    expect(seen?.eventId).toBe("e1");
    expect(seen?.platform).toBe("slack");
  });

  it("acks the delivery after the handler completes", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const bot = createBot({
      adapters: [intelligenceAdapter({ source, egress })],
      agent: () => new FakeAgent(),
    });
    bot.onMessage(async () => {});
    await bot.start();
    await source.deliver(envelope({ deliveryId: "d9" }));
    expect(source.acked).toEqual(["d9"]);
    expect(source.nacked).toEqual([]);
  });

  it("nacks the delivery when the handler throws", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const bot = createBot({
      adapters: [intelligenceAdapter({ source, egress })],
      agent: () => new FakeAgent(),
    });
    bot.onMessage(async () => {
      throw new Error("boom");
    });
    await bot.start();
    await source.deliver(envelope({ deliveryId: "d9" }));
    expect(source.acked).toEqual([]);
    expect(source.nacked.map((n) => n.deliveryId)).toEqual(["d9"]);
  });
});

describe("intelligenceAdapter — deterministic egress ids", () => {
  it("mints turnId:seq op ids and reproduces them on redelivery", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const bot = createBot({
      adapters: [intelligenceAdapter({ source, egress })],
      agent: () => new FakeAgent(),
    });
    bot.onMessage(async ({ thread }) => {
      await thread.post(Section({ children: "a" }));
      await thread.post(Section({ children: "b" }));
    });
    await bot.start();

    await source.deliver(envelope({ turnId: "t1", deliveryId: "d1" }));
    expect(egress.ops.map((o) => o.operationId)).toEqual(["t1:0", "t1:1"]);

    // Crash-before-ack redelivery: same turn id (and event id), new delivery id.
    // The handler re-runs (no ingress dedup on the managed path) and re-emits
    // the SAME op ids, so the Connector Outbox can dedupe the Slack output.
    egress.ops.length = 0;
    await source.deliver(envelope({ turnId: "t1", deliveryId: "d2" }));
    expect(egress.ops.map((o) => o.operationId)).toEqual(["t1:0", "t1:1"]);
  });
});

describe("intelligenceAdapter — run renderer", () => {
  it("emits a post egress op for streamed agent text", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const adapter = intelligenceAdapter({ source, egress });
    const renderer = adapter.createRunRenderer({
      route: { r: 1 },
      turnId: "t1",
      deliveryId: "d1",
    } as unknown as ReplyTarget);
    const sub = renderer.subscriber as unknown as Record<
      string,
      (p: { event: Record<string, unknown> }) => unknown
    >;
    sub.onTextMessageStartEvent?.({ event: { messageId: "m1" } });
    sub.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "hello " },
    });
    sub.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "world" },
    });
    await sub.onTextMessageEndEvent?.({ event: { messageId: "m1" } });

    expect(egress.ops).toHaveLength(1);
    expect(egress.ops[0]!.op.kind).toBe("post");
  });
});

describe("intelligenceAdapter — all ingress kinds route to bot core", () => {
  const base: ManagedIngressBase = {
    deliveryId: "d1",
    eventId: "e1",
    turnId: "t1",
    botName: "support",
    platform: "slack",
    conversationKey: "c1",
    route: { r: 1 },
  };

  it("routes a command to onCommand", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const bot = createBot({
      adapters: [intelligenceAdapter({ source, egress })],
      agent: () => new FakeAgent(),
    });
    let ran = "";
    bot.onCommand("triage", async ({ thread, text }) => {
      ran = text;
      await thread.post(Section({ children: "ok" }));
    });
    await bot.start();
    await source.deliver({
      ...base,
      kind: "command",
      command: "triage",
      text: "now",
    });
    expect(ran).toBe("now");
    expect(egress.ops).toHaveLength(1);
  });

  it("routes an interaction to a registered onInteraction handler", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const bot = createBot({
      adapters: [intelligenceAdapter({ source, egress })],
      agent: () => new FakeAgent(),
    });
    let seenValue: unknown;
    bot.onInteraction("ck:1", async ({ thread, action }) => {
      seenValue = action.value;
      await thread.post(Section({ children: "clicked" }));
    });
    await bot.start();
    await source.deliver({
      ...base,
      kind: "interaction",
      actionId: "ck:1",
      value: { page: 2 },
    });
    expect(seenValue).toEqual({ page: 2 });
    expect(egress.ops).toHaveLength(1);
  });

  it("routes a thread_started event to onThreadStarted", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const bot = createBot({
      adapters: [intelligenceAdapter({ source, egress })],
      agent: () => new FakeAgent(),
    });
    let ran = false;
    bot.onThreadStarted(async ({ thread }) => {
      ran = true;
      await thread.post(Section({ children: "hi" }));
    });
    await bot.start();
    await source.deliver({ ...base, kind: "thread_started" });
    expect(ran).toBe(true);
    expect(egress.ops).toHaveLength(1);
  });

  it("routes a reaction to onReaction", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const bot = createBot({
      adapters: [intelligenceAdapter({ source, egress })],
      agent: () => new FakeAgent(),
    });
    let seenEmoji = "";
    bot.onReaction(async (evt) => {
      seenEmoji = evt.rawEmoji;
    });
    await bot.start();
    await source.deliver({
      ...base,
      kind: "reaction",
      rawEmoji: "+1",
      added: true,
      messageId: "m1",
    });
    expect(seenEmoji).toBe("+1");
  });
});

describe("intelligenceAdapter — exclusivity (V1)", () => {
  const ia = () =>
    intelligenceAdapter({
      source: new InMemoryDeliverySource(),
      egress: new InMemoryEgressSink(),
    });

  it("rejects combining with another adapter at construction", () => {
    expect(() =>
      createBot({
        adapters: [ia(), new FakeAdapter()],
        agent: () => new FakeAgent(),
      }),
    ).toThrow(/only adapter|alternative modes/i);
  });

  it("rejects adding a second adapter to a managed bot", () => {
    const bot = createBot({ adapters: [ia()], agent: () => new FakeAgent() });
    expect(() => bot.addAdapter(new FakeAdapter())).toThrow(
      /only adapter|alternative modes/i,
    );
  });

  it("rejects adding intelligenceAdapter to a bot that already has an adapter", () => {
    const bot = createBot({
      adapters: [new FakeAdapter()],
      agent: () => new FakeAgent(),
    });
    expect(() => bot.addAdapter(ia())).toThrow(
      /only adapter|alternative modes/i,
    );
  });
});
