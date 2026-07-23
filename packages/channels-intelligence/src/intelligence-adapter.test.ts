import { describe, it, expect } from "vitest";
import {
  createChannel,
  FakeAdapter,
  FakeAgent,
} from "@copilotkit/channels-core";
import type { ReplyTarget } from "@copilotkit/channels-core";
import { Section } from "@copilotkit/channels-ui";
import type { IncomingMessage } from "@copilotkit/channels-ui";
import { intelligenceAdapter } from "./intelligence-adapter.js";
import {
  InMemoryDeliverySource,
  InMemoryEgressSink,
  InMemoryRenderEventSink,
} from "./in-memory-transports.js";
import { IntelligenceStateStore } from "./intelligence-state-store.js";
import type { FetchLike } from "./http-transports.js";
import type { EgressSink } from "./transports.js";
import type {
  ChannelIngressEnvelope,
  ChannelIngressBase,
} from "./contracts.js";

type TurnEnvelope = Extract<ChannelIngressEnvelope, { kind: "turn" }>;
function envelope(partial?: Partial<TurnEnvelope>): ChannelIngressEnvelope {
  return {
    deliveryId: "d1",
    eventId: "e1",
    turnId: "t1",
    channelName: "support",
    platform: "slack",
    conversationKey: "c1",
    kind: "turn",
    text: "hello",
    route: { r: 1 },
    ...partial,
  };
}

describe("intelligenceAdapter — ingress dispatch", () => {
  it("dispatches a channel turn to the handler and emits a post egress op", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const bot = createChannel({
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

  it("maps the provider actor display name onto PlatformUser.name for handlers", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const channel = createChannel({
      adapters: [intelligenceAdapter({ source, egress })],
      agent: () => new FakeAgent(),
    });
    let seenUser: { id: string; name?: string } | undefined;
    channel.onMessage(async ({ message }) => {
      seenUser = message.user;
    });
    await channel.start();
    // The wire field is `displayName`; it must surface as PlatformUser.name so
    // `message.user.name` is observable through the typed API (parity with the
    // direct Slack adapter, which populates `name`).
    await source.deliver(
      envelope({ user: { id: "u1", displayName: "Ada Lovelace" } }),
    );

    expect(seenUser?.id).toBe("u1");
    expect(seenUser?.name).toBe("Ada Lovelace");
  });

  it("acks the delivery after the handler completes", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const bot = createChannel({
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
    const bot = createChannel({
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

describe("intelligenceAdapter — inbound file content parts", () => {
  it("hydrates turn file refs into contentParts via the source's fetchFile", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const png = new Uint8Array([1, 2, 3, 4]);
    source.files.set("fileref_abc", { bytes: png, mimeType: "image/png" });
    const bot = createChannel({
      adapters: [intelligenceAdapter({ source, egress })],
      agent: () => new FakeAgent(),
    });
    let seen: IncomingMessage | undefined;
    bot.onMessage(async ({ message }) => {
      seen = message;
    });
    await bot.start();
    await source.deliver(
      envelope({
        text: "what is this?",
        files: [
          {
            handle: "fileref_abc",
            filename: "shot.png",
            mimeType: "image/png",
          },
        ],
      }),
    );

    expect(seen?.contentParts).toEqual([
      {
        type: "image",
        source: {
          type: "data",
          value: Buffer.from(png).toString("base64"),
          mimeType: "image/png",
        },
      },
    ]);
  });

  it("surfaces a fail-visible text note when a file can't be fetched (turn still dispatches)", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    // No file seeded → fetchFile throws → the part degrades to a text note
    // (fail-visible, not dropped) and the turn still dispatches + acks.
    const bot = createChannel({
      adapters: [intelligenceAdapter({ source, egress })],
      agent: () => new FakeAgent(),
    });
    let seen: IncomingMessage | undefined;
    bot.onMessage(async ({ message }) => {
      seen = message;
    });
    await bot.start();
    await source.deliver(
      envelope({
        text: "hi",
        files: [
          { handle: "missing", filename: "x.png", mimeType: "image/png" },
        ],
      }),
    );

    expect(seen?.text).toBe("hi");
    expect(seen?.contentParts).toEqual([
      { type: "text", text: "[attached file x.png could not be retrieved]" },
    ]);
    expect(source.acked).toEqual(["d1"]);
  });

  it("decodes a text/* file inline as a text content part", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    source.files.set("fileref_txt", {
      bytes: new TextEncoder().encode("hello from a file"),
      mimeType: "text/plain",
    });
    const bot = createChannel({
      adapters: [intelligenceAdapter({ source, egress })],
      agent: () => new FakeAgent(),
    });
    let seen: IncomingMessage | undefined;
    bot.onMessage(async ({ message }) => {
      seen = message;
    });
    await bot.start();
    await source.deliver(
      envelope({
        files: [
          {
            handle: "fileref_txt",
            filename: "note.txt",
            mimeType: "text/plain",
          },
        ],
      }),
    );

    expect(seen?.contentParts).toEqual([
      { type: "text", text: "hello from a file" },
    ]);
  });

  it("degrades an unknown-mime file to a short text note", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    source.files.set("fileref_zip", {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "application/zip",
    });
    const bot = createChannel({
      adapters: [intelligenceAdapter({ source, egress })],
      agent: () => new FakeAgent(),
    });
    let seen: IncomingMessage | undefined;
    bot.onMessage(async ({ message }) => {
      seen = message;
    });
    await bot.start();
    await source.deliver(
      envelope({
        files: [
          {
            handle: "fileref_zip",
            filename: "archive.zip",
            mimeType: "application/zip",
          },
        ],
      }),
    );

    expect(seen?.contentParts).toEqual([
      { type: "text", text: "[attached file: archive.zip (application/zip)]" },
    ]);
  });
});

describe("intelligenceAdapter — deterministic egress ids", () => {
  it("mints turnId:seq op ids and reproduces them on redelivery", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const bot = createChannel({
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
    // The handler re-runs (no ingress dedup on the Channel path) and re-emits
    // the SAME op ids, so the Connector Outbox can dedupe the Slack output.
    egress.ops.length = 0;
    await source.deliver(envelope({ turnId: "t1", deliveryId: "d2" }));
    expect(egress.ops.map((o) => o.operationId)).toEqual(["t1:0", "t1:1"]);
  });
});

describe("intelligenceAdapter — egress fail-loud", () => {
  it("throws (does not silently ack) when egress reports { ok: false }", async () => {
    const source = new InMemoryDeliverySource();
    // Egress that always rejects the op — the HTTP-fallback failure the adapter
    // used to swallow by minting a synthetic MessageRef and acking as success.
    const failingEgress: EgressSink = {
      emit: async () => ({ ok: false, code: "provider_rejected" }),
    };
    const channel = createChannel({
      adapters: [intelligenceAdapter({ source, egress: failingEgress })],
      agent: () => new FakeAgent(),
    });
    let postError: unknown;
    channel.onMessage(async ({ thread }) => {
      try {
        await thread.post(Section({ children: "reply" }));
      } catch (err) {
        postError = err;
      }
    });
    await channel.start();
    await source.deliver(envelope());

    // Before the fix, thread.post resolved with a synthetic ref and postError
    // stayed undefined (the drop was acked as success). Now it throws. (This
    // test asserts the throw at the post() boundary; the handler catches it
    // here, so no nack is exercised — the run-loop's nack-on-throw is covered
    // by the render-events dispatch tests.)
    expect(postError).toBeInstanceOf(Error);
    expect((postError as Error).message).toMatch(/egress post failed/i);
    expect((postError as Error).message).toContain("provider_rejected");
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
    // Render frames stream through a serial chain; the turn-end hook drains it.
    await renderer.finish?.();

    expect(egress.ops).toHaveLength(1);
    expect(egress.ops[0]!.op.kind).toBe("post");
  });
});

describe("intelligenceAdapter — HTTP-fallback run_error (OSS-491)", () => {
  const target = {
    route: { r: 1 },
    turnId: "t1",
    deliveryId: "d1",
  } as unknown as ReplyTarget;

  type Sub = Record<string, (p: { event: Record<string, unknown> }) => unknown>;

  it("surfaces a text-less run_error as a user-visible error post and logs it (fallback path)", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const logs: { msg: string; meta?: unknown }[] = [];
    // Fallback path: no renderSink wired, so the ad-hoc plain-text sink runs and
    // (before the fix) drops run_error — the run resolves and dispatch() acks a
    // text-less turn as success (bot goes silent, nothing logged).
    const adapter = intelligenceAdapter({
      source,
      egress,
      config: { log: (msg, meta) => logs.push({ msg, meta }) },
    });
    const renderer = adapter.createRunRenderer(target);
    const sub = renderer.subscriber as unknown as Sub;

    // An agent-side failure (model error / tool crash) with no accompanying text.
    sub.onRunErrorEvent?.({ event: { message: "model exploded" } });
    await renderer.finish?.();

    // (b) A user-visible error post is emitted rather than the turn completing
    // silently. We post + log + ack (not nack): a run_error is frequently a
    // deterministic agent failure and the Channel path reprocesses redeliveries
    // (skipIngressDedup), so nacking would livelock.
    expect(egress.ops).toHaveLength(1);
    expect(egress.ops[0]!.op.kind).toBe("post");
    const op = egress.ops[0]!.op as unknown as {
      kind: string;
      ir: { props: { value: string } }[];
    };
    expect(op.ir[0]!.props.value).toMatch(/error/i);
    // (a) And the underlying error is logged so a dropped error is never invisible.
    expect(logs.some((l) => /run_error/i.test(l.msg))).toBe(true);
    expect(logs.some((l) => l.meta === "model exploded")).toBe(true);
  });

  it("emits run_started before a run_error that precedes any text or tool event", async () => {
    const source = new InMemoryDeliverySource();
    const renderSink = new InMemoryRenderEventSink();
    // Realtime path: render frames are observable directly on the sink.
    const adapter = intelligenceAdapter({
      source,
      egress: new InMemoryEgressSink(),
      renderSink,
    });
    const renderer = adapter.createRunRenderer(target);
    const sub = renderer.subscriber as unknown as Sub;

    // Error before any text/tool event: it must still be preceded by run_started
    // so the frame stream is a well-formed run lifecycle.
    sub.onRunErrorEvent?.({ event: { message: "boom" } });
    await renderer.finish?.();

    const kinds = renderSink.frames.map((f) => f.event.kind);
    expect(kinds[0]).toBe("run_started");
    expect(kinds).toContain("run_error");
    expect(kinds.indexOf("run_started")).toBeLessThan(
      kinds.indexOf("run_error"),
    );
  });

  it("renders run_error live on the realtime path (no user-visible error post) — unchanged", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const renderSink = new InMemoryRenderEventSink();
    const adapter = intelligenceAdapter({ source, egress, renderSink });
    const renderer = adapter.createRunRenderer(target);
    const sub = renderer.subscriber as unknown as Sub;

    sub.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "partial" },
    });
    await sub.onTextMessageEndEvent?.({ event: { messageId: "m1" } });
    sub.onRunErrorEvent?.({ event: { message: "later boom" } });
    await renderer.finish?.();

    // The realtime path forwards run_error to the render sink (the Connector
    // Outbox renders it live) — it is NOT converted into an egress error post…
    expect(renderSink.frames.map((f) => f.event.kind)).toEqual([
      "run_started",
      "text_delta",
      "text_end",
      "run_error",
      "finalize",
    ]);
    // …and the fallback error-post path never runs on the realtime path.
    expect(egress.ops).toEqual([]);
  });
});

describe("intelligenceAdapter — ack failure isolation (OSS-491)", () => {
  it("does not nack or rerun a completed turn when ack() throws; logs the ack failure", async () => {
    // A source whose ack() network call fails but whose turn processed fine.
    class AckFailingSource extends InMemoryDeliverySource {
      override async ack(): Promise<void> {
        throw new Error("ack network down");
      }
    }
    const source = new AckFailingSource();
    const egress = new InMemoryEgressSink();
    const logs: { msg: string; meta?: unknown }[] = [];
    const bot = createChannel({
      adapters: [
        intelligenceAdapter({
          source,
          egress,
          config: { log: (msg, meta) => logs.push({ msg, meta }) },
        }),
      ],
      agent: () => new FakeAgent(),
    });
    let dispatchCount = 0;
    bot.onMessage(async () => {
      dispatchCount++;
    });
    await bot.start();
    await source.deliver(envelope({ deliveryId: "d9" }));

    // The turn processed exactly once…
    expect(dispatchCount).toBe(1);
    // …and a failed ack must NOT be conflated with a turn failure: no nack
    // (which, with skipIngressDedup, would redeliver and rerun the whole turn).
    expect(source.nacked).toEqual([]);
    // The ack failure is logged, not silently swallowed.
    expect(logs.some((l) => /ack/i.test(l.msg))).toBe(true);
  });
});

describe("intelligenceAdapter — all ingress kinds route to bot core", () => {
  const base: ChannelIngressBase = {
    deliveryId: "d1",
    eventId: "e1",
    turnId: "t1",
    channelName: "support",
    platform: "slack",
    conversationKey: "c1",
    route: { r: 1 },
  };

  it("routes a command to onCommand", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const bot = createChannel({
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
    const bot = createChannel({
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

  it("stamps the clicked card's ref so an in-place update routes under the live delivery", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const bot = createChannel({
      adapters: [intelligenceAdapter({ source, egress })],
      agent: () => new FakeAgent(),
    });
    bot.onInteraction("ck:approve", async ({ thread, message }) => {
      // Flip the card that was clicked (posted in a PRIOR delivery) in place.
      await thread.update(message.ref, Section({ children: "approved" }));
    });
    await bot.start();
    await source.deliver({
      ...base,
      deliveryId: "d_click",
      turnId: "t_click",
      kind: "interaction",
      actionId: "ck:approve",
      value: { ok: true },
      // app-api mints the ref as the original card's Slack ts; it carries no
      // SDK routing until this delivery's route/turnId/deliveryId is stamped on.
      messageRef: { id: "1699999999.000100" },
    });

    expect(egress.ops).toHaveLength(1);
    const op = egress.ops[0]!;
    // Re-addresses the ORIGINAL card ts (Connector Outbox chat.updates in place)…
    expect(op.op).toMatchObject({ kind: "update", ref: "1699999999.000100" });
    // …routed under THIS interaction delivery, not the deliveryId:"undefined"
    // the stamping exists to prevent (which would dead-letter the update).
    expect(op.deliveryId).toBe("d_click");
    expect(op.turnId).toBe("t_click");
    expect(op.route).toEqual(base.route);
  });

  it("routes a thread_started event to onThreadStarted", async () => {
    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const bot = createChannel({
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
    const bot = createChannel({
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
      createChannel({
        adapters: [ia(), new FakeAdapter()],
        agent: () => new FakeAgent(),
      }),
    ).toThrow(/only adapter|alternative modes/i);
  });

  it("rejects adding a second adapter to a Channel Bot", () => {
    const bot = createChannel({
      adapters: [ia()],
      agent: () => new FakeAgent(),
    });
    expect(() => bot.addAdapter(new FakeAdapter())).toThrow(
      /only adapter|alternative modes/i,
    );
  });

  it("rejects adding intelligenceAdapter to a bot that already has an adapter", () => {
    const bot = createChannel({
      adapters: [new FakeAdapter()],
      agent: () => new FakeAgent(),
    });
    expect(() => bot.addAdapter(ia())).toThrow(
      /only adapter|alternative modes/i,
    );
  });
});

describe("intelligenceAdapter — conversation-history seeding", () => {
  const target = {
    route: { teamId: "T1", channel: "C1", threadTs: "1.2" },
    turnId: "t1",
    deliveryId: "d1",
  };

  it("seeds agent.messages from the source's getHistory", async () => {
    const source = new InMemoryDeliverySource();
    source.history = [
      { id: "h1", role: "user", content: "earlier question" },
      { id: "h2", role: "assistant", content: "earlier answer" },
    ];
    const adapter = intelligenceAdapter({
      source,
      egress: new InMemoryEgressSink(),
    });

    const { agent } = await adapter.conversationStore.getOrCreate(
      "c1",
      target,
      () => new FakeAgent(),
    );

    expect(agent.messages).toEqual(source.history);
  });

  it("getMessages maps history (string + content-part array) to ThreadMessage[]", async () => {
    const source = new InMemoryDeliverySource();
    source.history = [
      { id: "h1", role: "user", content: "hi there" },
      {
        id: "h2",
        role: "assistant",
        content: [
          { type: "text", text: "part one" },
          {
            type: "image",
            source: { type: "data", value: "x", mimeType: "image/png" },
          },
          { type: "text", text: "part two" },
        ],
      },
    ] as unknown as typeof source.history;
    const adapter = intelligenceAdapter({
      source,
      egress: new InMemoryEgressSink(),
    });

    const messages = await adapter.getMessages(target);

    expect(messages).toEqual([
      // string content → text; role 'user' → isBot false, user 'user'.
      { text: "hi there", isBot: false, user: { id: "user", name: "user" } },
      // content-part array → text parts joined; the non-text (image) part
      // contributes no text and is dropped before the join, so there is no
      // stray doubled space; assistant → bot.
      {
        text: "part one part two",
        isBot: true,
        user: { id: "bot", name: "bot" },
      },
    ]);
  });

  it("getMessages returns [] when the transport has no getHistory", async () => {
    const source = new InMemoryDeliverySource();
    // Shadow the prototype method with an own `undefined` — `delete` wouldn't
    // remove a prototype method, so the `source?.getHistory?.()` short-circuit
    // (the branch under test) would never actually be exercised.
    (source as { getHistory?: unknown }).getHistory = undefined;
    const adapter = intelligenceAdapter({
      source,
      egress: new InMemoryEgressSink(),
    });
    expect(await adapter.getMessages(target)).toEqual([]);
  });

  it("unwraps the ChannelReplyTarget to the raw route and defaults historyLimit to 20", async () => {
    const source = new InMemoryDeliverySource();
    const adapter = intelligenceAdapter({
      source,
      egress: new InMemoryEgressSink(),
    });

    await adapter.conversationStore.getOrCreate(
      "c1",
      target,
      () => new FakeAgent(),
    );

    expect(source.historyRequests).toEqual([
      { replyTarget: target.route, limit: 20 },
    ]);
  });

  it("threads a custom historyLimit through to getHistory", async () => {
    const source = new InMemoryDeliverySource();
    const adapter = intelligenceAdapter({
      source,
      egress: new InMemoryEgressSink(),
      historyLimit: 5,
    });

    await adapter.conversationStore.getOrCreate(
      "c1",
      target,
      () => new FakeAgent(),
    );

    expect(source.historyRequests[0]?.limit).toBe(5);
  });

  it("starts fresh (empty messages) when the transport has no getHistory", async () => {
    const source = new InMemoryDeliverySource();
    // Shadow the prototype method with an own `undefined` — `delete` wouldn't
    // remove a prototype method, so the `source?.getHistory?.()` short-circuit
    // (the branch under test) would never actually be exercised.
    (source as { getHistory?: unknown }).getHistory = undefined;
    const adapter = intelligenceAdapter({
      source,
      egress: new InMemoryEgressSink(),
    });

    const { agent } = await adapter.conversationStore.getOrCreate(
      "c1",
      target,
      () => new FakeAgent(),
    );

    expect(agent.messages).toEqual([]);
  });
});

describe("intelligenceAdapter — default store resolution", () => {
  it("builds an IntelligenceStateStore from config, stripping the baseUrl trailing slash", async () => {
    const calls: string[] = [];
    const fetch = (async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ value: null }),
      };
    }) as unknown as FetchLike;
    const adapter = intelligenceAdapter({
      config: { baseUrl: "http://intel.test/", apiKey: "cpk-1", fetch },
    });

    expect(adapter.stateStore).toBeInstanceOf(IntelligenceStateStore);
    await adapter.stateStore!.kv.get("k");
    expect(calls[0]).toBe("http://intel.test/api/channels/kv/get");
  });

  it("skips the default store when in-memory transports are injected", () => {
    const adapter = intelligenceAdapter({
      source: new InMemoryDeliverySource(),
      egress: new InMemoryEgressSink(),
    });

    expect(adapter.stateStore).toBeUndefined();
  });

  it("skips the default store when credentials can't be resolved", () => {
    const adapter = intelligenceAdapter({
      config: { baseUrl: "http://intel.test" },
    });

    expect(adapter.stateStore).toBeUndefined();
  });
});
