import { describe, it, expect } from "vitest";
import { createBot, FakeAgent } from "@copilotkit/bot";
import type { BotNode } from "@copilotkit/bot-ui";
import {
  HttpDeliverySource,
  HttpEgressSink,
  resolveTransportConfig,
} from "./http-transports.js";
import type {
  FetchLike,
  IntelligenceTransportConfig,
} from "./http-transports.js";
import { intelligenceAdapter } from "./intelligence-adapter.js";
import type { EgressOperation } from "./contracts.js";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(
  handler: (call: Call) => { ok?: boolean; status?: number; body?: unknown },
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: init.method,
      headers: init.headers,
      body: JSON.parse(init.body) as Record<string, unknown>,
    };
    calls.push(call);
    const r = handler(call);
    const status = r.status ?? (r.ok === false ? 500 : 200);
    return {
      ok: r.ok ?? status < 400,
      status,
      async text() {
        return r.body === undefined ? "" : JSON.stringify(r.body);
      },
    };
  };
  return { fetch, calls };
}

function cfg(
  over: Partial<IntelligenceTransportConfig>,
): IntelligenceTransportConfig {
  return resolveTransportConfig({
    baseUrl: "http://x",
    apiKey: "cpk-test",
    botName: "opentagbot",
    runtimeInstanceId: "rti_test",
    adapter: "slack",
    sleep: async () => {},
    ...over,
  });
}

const text = (value: string): BotNode =>
  ({ type: "text", props: { value } }) as unknown as BotNode;

const claimedDelivery = (over?: Record<string, unknown>) => ({
  id: "dlv_9",
  attempt: 1,
  bot: { id: "bot_1", name: "opentagbot" },
  adapter: "slack",
  leaseToken: "lease_z",
  leaseExpiresAt: "2026-06-30T00:00:00.000Z",
  turn: {
    id: "turn_9",
    eventId: "evt_9",
    receivedAt: "2026-06-30T00:00:00.000Z",
    replyTarget: {
      adapter: "slack",
      teamId: "T1",
      channel: "C1",
      threadTs: "1.2",
    },
    input: { kind: "text", text: "hello" },
  },
  ...over,
});

describe("resolveTransportConfig", () => {
  it("throws loudly when required fields are missing", () => {
    // No overrides + (assumed) no COPILOTKIT_* env in the test runner.
    expect(() =>
      resolveTransportConfig({ baseUrl: "", apiKey: "", botName: "" }),
    ).toThrow(/missing required transport config/);
  });
});

describe("HttpEgressSink", () => {
  it("posts flattened text with the op id as idempotency key", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      body: { operationId: "eop_1", status: "sent", acceptedAt: "t" },
    }));
    const sink = new HttpEgressSink(cfg({ fetch }));
    const op: EgressOperation = {
      operationId: "turn_9:0",
      turnId: "turn_9",
      deliveryId: "dlv_9",
      route: { adapter: "slack", teamId: "T1", channel: "C1", threadTs: "1.2" },
      op: { kind: "post", ir: [text("hi")] },
    };
    const res = await sink.emit(op);
    expect(res).toEqual({ ok: true, ref: "eop_1" });
    expect(calls[0]!.url).toBe("http://x/api/bots/egress/messages");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer cpk-test");
    expect(calls[0]!.body).toMatchObject({
      botName: "opentagbot",
      adapter: "slack",
      deliveryId: "dlv_9",
      idempotencyKey: "turn_9:0",
      replyTarget: { teamId: "T1", channel: "C1" },
      text: "hi",
    });
  });

  it("maps a failed status to ok:false with the failure code", async () => {
    const { fetch } = fakeFetch(() => ({
      body: {
        operationId: "eop_2",
        status: "failed",
        acceptedAt: "t",
        error: { code: "provider_error", message: "x", retryable: true },
      },
    }));
    const sink = new HttpEgressSink(cfg({ fetch }));
    const res = await sink.emit({
      operationId: "turn_9:0",
      turnId: "turn_9",
      deliveryId: "dlv_9",
      route: { adapter: "slack", teamId: "T1", channel: "C1" },
      op: { kind: "post", ir: [text("hi")] },
    });
    expect(res).toEqual({ ok: false, code: "provider_error" });
  });

  it("no-ops delete ops and empty text without hitting the network", async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: {} }));
    const sink = new HttpEgressSink(cfg({ fetch }));
    expect(
      await sink.emit({
        operationId: "turn_9:0",
        turnId: "turn_9",
        deliveryId: "dlv_9",
        route: {},
        op: { kind: "delete", ref: "r" },
      }),
    ).toEqual({ ok: true, ref: "turn_9:0" });
    expect(
      await sink.emit({
        operationId: "turn_9:1",
        turnId: "turn_9",
        deliveryId: "dlv_9",
        route: {},
        op: { kind: "post", ir: [] },
      }),
    ).toEqual({ ok: true, ref: "turn_9:1" });
    expect(calls).toHaveLength(0);
  });
});

describe("HttpDeliverySource", () => {
  it("heartbeat declares the bot + adapter", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      body: {
        runtimeInstanceId: "rti_test",
        receivedAt: "t",
        leaseExpiresAt: "t",
        bots: [],
      },
    }));
    const src = new HttpDeliverySource(cfg({ fetch }));
    await src.heartbeat();
    expect(calls[0]!.url).toBe("http://x/api/bots/listener/heartbeat");
    expect(calls[0]!.body).toMatchObject({
      runtimeInstanceId: "rti_test",
      declaredBots: [{ botName: "opentagbot", adapter: "slack" }],
    });
  });

  it("claimOnce maps a claimed delivery to a turn envelope with a stable conversationKey", async () => {
    const { fetch } = fakeFetch(() => ({
      body: { claimed: true, delivery: claimedDelivery() },
    }));
    const src = new HttpDeliverySource(cfg({ fetch }));
    const r = await src.claimOnce();
    expect("env" in r).toBe(true);
    if (!("env" in r)) throw new Error("expected env");
    expect(r.env).toMatchObject({
      kind: "turn",
      deliveryId: "dlv_9",
      turnId: "turn_9",
      eventId: "evt_9",
      botName: "opentagbot",
      platform: "slack",
      text: "hello",
      route: { teamId: "T1" },
    });
    expect(r.env.conversationKey).toBe("slack:T1:C1:thread:1.2");
  });

  it("claimOnce returns pollAfterMs when idle", async () => {
    const { fetch } = fakeFetch(() => ({
      body: { claimed: false, pollAfterMs: 500 },
    }));
    const src = new HttpDeliverySource(cfg({ fetch }));
    expect(await src.claimOnce()).toEqual({ pollAfterMs: 500 });
  });

  it("ack uses the lease token + turn id stashed from the claim", async () => {
    const { fetch, calls } = fakeFetch((c) =>
      c.url.endsWith("/claim")
        ? { body: { claimed: true, delivery: claimedDelivery() } }
        : { body: { acknowledged: true } },
    );
    const src = new HttpDeliverySource(cfg({ fetch }));
    await src.claimOnce();
    await src.ack("dlv_9");
    const ack = calls.find((c) => c.url.includes("/deliveries/dlv_9/ack"))!;
    expect(ack.body).toMatchObject({
      turnId: "turn_9",
      leaseToken: "lease_z",
      runtimeInstanceId: "rti_test",
    });
  });

  it("nack posts a retryable runtime_error fail", async () => {
    const { fetch, calls } = fakeFetch((c) =>
      c.url.endsWith("/claim")
        ? { body: { claimed: true, delivery: claimedDelivery() } }
        : {
            body: { failed: true, retryScheduled: true, status: "retry_wait" },
          },
    );
    const src = new HttpDeliverySource(cfg({ fetch }));
    await src.claimOnce();
    await src.nack("dlv_9", "boom");
    const fail = calls.find((c) => c.url.includes("/deliveries/dlv_9/fail"))!;
    expect(fail.body["error"]).toMatchObject({
      code: "runtime_error",
      message: "boom",
      retryable: true,
    });
  });
});

describe("intelligenceAdapter() — config-free default transports", () => {
  it("is callable with zero arguments (config-free)", () => {
    // Compile-time + runtime guard: intelligenceAdapter() must take no required
    // args so consumers can write createBot({ adapters: [intelligenceAdapter()] }).
    const adapter = intelligenceAdapter();
    expect(adapter.platform).toBe("intelligence");
  });

  it("builds HTTP transports and takes botName from createBot({ name })", async () => {
    const { fetch, calls } = fakeFetch((c) =>
      c.url.endsWith("/heartbeat")
        ? {
            body: {
              runtimeInstanceId: "rti_test",
              receivedAt: "t",
              leaseExpiresAt: "t",
              bots: [],
            },
          }
        : { body: { claimed: false, pollAfterMs: 60000 } },
    );
    const bot = createBot({
      name: "opentagbot",
      agent: () => new FakeAgent(),
      // No source/egress injected -> default HTTP transports; no botName in
      // config -> must come from createBot({ name }) via the start() context.
      adapters: [
        intelligenceAdapter({
          config: {
            baseUrl: "http://x",
            apiKey: "cpk-test",
            runtimeInstanceId: "rti_test",
            fetch,
            sleep: () => new Promise((r) => setTimeout(r, 1)),
          },
        }),
      ],
    });
    await bot.start();
    // Let the loop heartbeat + poll at least once.
    const deadline = Date.now() + 200;
    while (
      Date.now() < deadline &&
      !calls.some((c) => c.url.endsWith("/claim"))
    ) {
      await new Promise((r) => setTimeout(r, 5));
    }
    await bot.stop();

    const hb = calls.find((c) => c.url.endsWith("/heartbeat"))!;
    expect(hb.body).toMatchObject({
      declaredBots: [{ botName: "opentagbot", adapter: "slack" }],
    });
    expect(calls.some((c) => c.url.endsWith("/claim"))).toBe(true);
  });
});
