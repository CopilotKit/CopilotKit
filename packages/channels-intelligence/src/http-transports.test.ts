import { describe, it, expect, vi, afterEach } from "vitest";
import { createChannel, FakeAgent } from "@copilotkit/channels-core";
import type { ChannelNode } from "@copilotkit/channels-ui";
import {
  HttpDeliverySource,
  HttpEgressSink,
  HttpRenderEventSink,
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

/**
 * `getHistory`/`fetchFile` bypass the injectable `cfg.fetch` (JSON/POST-only)
 * and hit the global `fetch` directly, same as the existing `fetchFile` /
 * `uploadFile` methods — so history tests stub `globalThis.fetch` instead.
 */
function stubGlobalFetch(
  handler: (
    url: string,
    init?: RequestInit,
  ) => {
    ok?: boolean;
    status?: number;
    json?: unknown;
    arrayBuffer?: ArrayBuffer;
    contentType?: string;
  },
): { calls: string[]; requests: Array<{ url: string; init?: RequestInit }> } {
  const calls: string[] = [];
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(url);
    requests.push({ url, init });
    const r = handler(url, init);
    const status = r.status ?? (r.ok === false ? 500 : 200);
    return {
      ok: r.ok ?? status < 400,
      status,
      headers: { get: (_k: string) => r.contentType ?? null },
      async json() {
        return r.json ?? {};
      },
      async arrayBuffer() {
        return r.arrayBuffer ?? new ArrayBuffer(0);
      },
    };
  });
  return { calls, requests };
}

function cfg(
  over: Partial<IntelligenceTransportConfig>,
): IntelligenceTransportConfig {
  return resolveTransportConfig({
    baseUrl: "http://x",
    apiKey: "cpk-test",
    channelName: "opentagbot",
    runtimeInstanceId: "rti_test",
    adapter: "slack",
    sleep: async () => {},
    ...over,
  });
}

const text = (value: string): ChannelNode =>
  ({ type: "text", props: { value } }) as unknown as ChannelNode;

const claimedDelivery = (over?: Record<string, unknown>) => ({
  id: "dlv_9",
  attempt: 1,
  organizationId: "org_1",
  projectId: 7,
  channel: { id: "channel_1", name: "opentagbot" },
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
      resolveTransportConfig({ baseUrl: "", apiKey: "", channelName: "" }),
    ).toThrow(/missing required transport config/);
  });

  it("requires COPILOTKIT_CHANNEL_NAME when no channel name is configured", () => {
    vi.stubEnv("COPILOTKIT_INTELLIGENCE_URL", "http://x");
    vi.stubEnv("COPILOTKIT_API_KEY", "cpk-test");
    vi.stubEnv("COPILOTKIT_CHANNEL_NAME", "");

    try {
      expect(() => resolveTransportConfig()).toThrow(
        /channelName.*COPILOTKIT_CHANNEL_NAME/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
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
    expect(calls[0]!.url).toBe("http://x/api/channels/egress/messages");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer cpk-test");
    expect(calls[0]!.body).toMatchObject({
      channelName: "opentagbot",
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

  it("fails loud on an empty-text update instead of silently acking a no-send", async () => {
    // An empty POST is a legitimate no-op (nothing to say), but an empty UPDATE
    // would silently drop a real intent (e.g. clearing a message body) this
    // post-only fallback egress cannot express. Acking it as success is
    // inconsistent with the module's fail-loud posture.
    const { fetch, calls } = fakeFetch(() => ({ body: {} }));
    const sink = new HttpEgressSink(cfg({ fetch }));
    const res = await sink.emit({
      operationId: "turn_9:2",
      turnId: "turn_9",
      deliveryId: "dlv_9",
      route: {},
      op: { kind: "update", ref: "r", ir: [] },
    });
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("posts the reply route's adapter, not the static config adapter (provider-agnostic egress)", async () => {
    // One provider-agnostic runtime serves every adapter the bot has attached,
    // so a Teams delivery must not carry the config's default adapter ("slack").
    // app-api routes on replyTarget.adapter + channelName, so derive the posted
    // adapter from the delivery's own reply route.
    const { fetch, calls } = fakeFetch(() => ({
      body: { operationId: "eop_t", status: "sent" },
    }));
    const sink = new HttpEgressSink(cfg({ fetch, adapter: "slack" }));
    await sink.emit({
      operationId: "turn_9:0",
      turnId: "turn_9",
      deliveryId: "dlv_9",
      route: {
        adapter: "teams",
        tenantId: "tenant-1",
        conversationId: "19:abc@thread.tacv2",
      },
      op: { kind: "post", ir: [text("hi")] },
    });
    expect(calls[0]!.body).toMatchObject({ adapter: "teams" });
  });
});

describe("HttpDeliverySource", () => {
  it("heartbeat declares the channel + adapter", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      body: {
        runtimeInstanceId: "rti_test",
        receivedAt: "t",
        leaseExpiresAt: "t",
        channels: [],
      },
    }));
    const src = new HttpDeliverySource(cfg({ fetch }));
    await src.heartbeat();
    expect(calls[0]!.url).toBe("http://x/api/channels/listener/heartbeat");
    expect(calls[0]!.body).toMatchObject({
      runtimeInstanceId: "rti_test",
      declaredChannels: [{ channelName: "opentagbot", adapter: "slack" }],
    });
  });

  it("claims from the channels listener and maps a delivery to a turn envelope", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      body: { claimed: true, delivery: claimedDelivery() },
    }));
    const src = new HttpDeliverySource(cfg({ fetch }));
    const r = await src.claimOnce();
    expect("env" in r).toBe(true);
    if (!("env" in r)) throw new Error("expected env");
    expect(calls[0]!.url).toBe("http://x/api/channels/listener/claim");
    expect(calls[0]!.body).toEqual({
      runtimeInstanceId: "rti_test",
    });
    expect(r.env).toMatchObject({
      kind: "turn",
      deliveryId: "dlv_9",
      turnId: "turn_9",
      eventId: "evt_9",
      channelName: "opentagbot",
      platform: "slack",
      text: "hello",
      route: { teamId: "T1" },
    });
    expect(r.env.conversationKey).toBe("slack:T1:C1:thread:1.2");
  });

  it("claimOnce derives a Teams conversationKey from tenantId+conversationId (provider-agnostic claim)", async () => {
    // Now that the runtime claims provider-agnostically, a Teams delivery flows
    // through the same bridge. Its reply target is a different shape (no
    // teamId/channel), so the conversationKey must be derived per-provider —
    // otherwise every Teams conversation collapses onto one agent/session.
    const { fetch } = fakeFetch(() => ({
      body: {
        claimed: true,
        delivery: claimedDelivery({
          adapter: "teams",
          turn: {
            id: "turn_9",
            eventId: "evt_9",
            receivedAt: "2026-06-30T00:00:00.000Z",
            replyTarget: {
              adapter: "teams",
              serviceUrl: "https://smba.trafficmanager.net/teams",
              conversationId: "19:abc@thread.tacv2",
              tenantId: "tenant-1",
            },
            input: { kind: "text", text: "hello" },
          },
        }),
      },
    }));
    const src = new HttpDeliverySource(cfg({ fetch }));
    const r = await src.claimOnce();
    expect("env" in r).toBe(true);
    if (!("env" in r)) throw new Error("expected env");
    expect(r.env).toMatchObject({
      kind: "turn",
      platform: "teams",
      text: "hello",
    });
    // Matches Intelligence app-api's thread_key = teams:{tenantId}:{conversationId}.
    expect(r.env.conversationKey).toBe("teams:tenant-1:19:abc@thread.tacv2");
    // Reply route is passed through verbatim for provider-agnostic egress.
    expect(r.env.route).toMatchObject({
      adapter: "teams",
      conversationId: "19:abc@thread.tacv2",
    });
  });

  it("claimOnce maps a claimed slash command delivery to a command envelope", async () => {
    const { fetch } = fakeFetch(() => ({
      body: {
        claimed: true,
        delivery: claimedDelivery({
          turn: {
            id: "turn_9",
            eventId: "evt_command",
            receivedAt: "2026-06-30T00:00:00.000Z",
            replyTarget: {
              adapter: "slack",
              teamId: "T1",
              channel: "C1",
            },
            input: {
              kind: "command",
              command: "/opentagbot",
              text: "summarize this channel",
              triggerId: "13345224609.738474920.8088930838d88f008e0",
            },
          },
        }),
      },
    }));
    const src = new HttpDeliverySource(cfg({ fetch }));
    const r = await src.claimOnce();
    expect("env" in r).toBe(true);
    if (!("env" in r)) throw new Error("expected env");
    expect(r.env).toMatchObject({
      kind: "command",
      deliveryId: "dlv_9",
      turnId: "turn_9",
      eventId: "evt_command",
      channelName: "opentagbot",
      platform: "slack",
      command: "/opentagbot",
      text: "summarize this channel",
      triggerId: "13345224609.738474920.8088930838d88f008e0",
      route: { teamId: "T1", channel: "C1" },
    });
    expect(r.env.conversationKey).toBe("slack:T1:C1:thread:root");
  });

  it("claimOnce maps a claimed reaction delivery to a reaction envelope", async () => {
    const { fetch } = fakeFetch(() => ({
      body: {
        claimed: true,
        delivery: claimedDelivery({
          turn: {
            id: "turn_9",
            eventId: "evt_reaction",
            receivedAt: "2026-06-30T00:00:00.000Z",
            replyTarget: {
              adapter: "slack",
              teamId: "T1",
              channel: "C1",
              threadTs: "1.2",
            },
            input: {
              kind: "reaction",
              rawEmoji: "thumbsup",
              added: true,
              messageId: "1.2",
              threadId: "1.2",
            },
          },
        }),
      },
    }));
    const src = new HttpDeliverySource(cfg({ fetch }));
    const r = await src.claimOnce();
    expect("env" in r).toBe(true);
    if (!("env" in r)) throw new Error("expected env");
    expect(r.env).toMatchObject({
      kind: "reaction",
      deliveryId: "dlv_9",
      turnId: "turn_9",
      eventId: "evt_reaction",
      channelName: "opentagbot",
      platform: "slack",
      rawEmoji: "thumbsup",
      added: true,
      messageId: "1.2",
      threadId: "1.2",
      route: { teamId: "T1", channel: "C1", threadTs: "1.2" },
    });
    expect(r.env.conversationKey).toBe("slack:T1:C1:thread:1.2");
  });

  it("claimOnce maps a claimed interaction delivery to an interaction envelope", async () => {
    const { fetch } = fakeFetch(() => ({
      body: {
        claimed: true,
        delivery: claimedDelivery({
          turn: {
            id: "turn_9",
            eventId: "evt_interaction",
            receivedAt: "2026-06-30T00:00:00.000Z",
            replyTarget: {
              adapter: "slack",
              teamId: "T1",
              channel: "C1",
              threadTs: "1.2",
            },
            input: {
              kind: "interaction",
              actionId: "ck:confirm_write:approve",
              value: { confirmed: true },
              messageRef: { id: "1.2" },
              triggerId: "13345224609.738474920.8088930838d88f008e0",
            },
          },
        }),
      },
    }));
    const src = new HttpDeliverySource(cfg({ fetch }));
    const r = await src.claimOnce();
    expect("env" in r).toBe(true);
    if (!("env" in r)) throw new Error("expected env");
    expect(r.env).toMatchObject({
      kind: "interaction",
      deliveryId: "dlv_9",
      turnId: "turn_9",
      eventId: "evt_interaction",
      channelName: "opentagbot",
      platform: "slack",
      actionId: "ck:confirm_write:approve",
      value: { confirmed: true },
      messageRef: { id: "1.2" },
      triggerId: "13345224609.738474920.8088930838d88f008e0",
      route: { teamId: "T1", channel: "C1", threadTs: "1.2" },
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
    const ack = calls.find((c) =>
      c.url.endsWith("/api/channels/deliveries/dlv_9/ack"),
    )!;
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
    const fail = calls.find((c) =>
      c.url.endsWith("/api/channels/deliveries/dlv_9/fail"),
    )!;
    expect(fail.body["error"]).toMatchObject({
      code: "runtime_error",
      message: "boom",
      retryable: true,
    });
  });

  it("nacks (non-retryable) an unmappable delivery kind instead of wedging the loop", async () => {
    const { fetch, calls } = fakeFetch((c) =>
      c.url.endsWith("/claim")
        ? {
            body: {
              claimed: true,
              // A future/unknown wire kind app-api might send. claimOnce must
              // not throw it up into runLoop (which only logs+sleeps, leaking
              // the lease until the 120s expiry redelivers the same poison
              // payload forever) — it nacks non-retryably and idles instead.
              delivery: claimedDelivery({
                turn: {
                  id: "turn_9",
                  eventId: "evt_x",
                  receivedAt: "2026-06-30T00:00:00.000Z",
                  replyTarget: {
                    adapter: "slack",
                    teamId: "T1",
                    channel: "C1",
                    threadTs: "1.2",
                  },
                  input: { kind: "telepathy" },
                },
              }),
            },
          }
        : { body: { failed: true, status: "dead_letter" } },
    );
    const src = new HttpDeliverySource(cfg({ fetch }));

    const r = await src.claimOnce();

    expect(r).toEqual({ pollAfterMs: 1000 });
    const fail = calls.find((c) => c.url.includes("/deliveries/dlv_9/fail"))!;
    expect(fail).toBeDefined();
    expect(fail.body["error"]).toMatchObject({ retryable: false });
  });

  it("times out a hung turn, nacks it, and keeps the loop alive", async () => {
    const { fetch, calls } = fakeFetch((c) =>
      c.url.endsWith("/claim")
        ? { body: { claimed: true, delivery: claimedDelivery() } }
        : { body: { failed: true, status: "retry_wait" } },
    );
    const src = new HttpDeliverySource(cfg({ fetch, turnTimeoutMs: 20 }));
    let started = 0;
    // A turn that never resolves (e.g. a HITL approval that never arrives) must
    // not wedge the single-delivery loop: it times out, gets nacked, loop continues.
    await src.start(async () => {
      started += 1;
      await new Promise<void>(() => {});
    });
    await new Promise((r) => setTimeout(r, 80));
    await src.stop();

    expect(started).toBeGreaterThanOrEqual(1);
    const fail = calls.find((c) => c.url.includes("/deliveries/dlv_9/fail"));
    expect(fail).toBeDefined();
    expect(fail!.body["error"]).toMatchObject({ code: "runtime_error" });
  });

  it("keeps heartbeating while a long turn is in flight (no mid-turn starvation)", async () => {
    const { fetch, calls } = fakeFetch((c) =>
      c.url.endsWith("/claim")
        ? { body: { claimed: true, delivery: claimedDelivery() } }
        : {
            body: {
              runtimeInstanceId: "rti_test",
              receivedAt: "t",
              leaseExpiresAt: "t",
              channels: [],
            },
          },
    );
    // Small cadence so the standalone heartbeat timer fires several times while
    // the turn is still running. The old top-of-loop heartbeat could not: the
    // loop blocks on onDelivery for up to turnTimeoutMs, so a turn longer than
    // the cadence sent no heartbeat and app-api could mark the runtime stale.
    const src = new HttpDeliverySource(cfg({ fetch, heartbeatIntervalMs: 10 }));
    let release: () => void = () => {};
    await src.start(async () => {
      await new Promise<void>((r) => {
        release = r;
      });
    });
    await new Promise((r) => setTimeout(r, 60));
    const heartbeatsDuringTurn = calls.filter((c) =>
      c.url.endsWith("/heartbeat"),
    ).length;
    release();
    await src.stop();

    // Initial heartbeat + at least one fired by the timer during the turn.
    expect(heartbeatsDuringTurn).toBeGreaterThanOrEqual(2);
  });

  it("stop() returns promptly while idle even mid poll-sleep (interruptible)", async () => {
    const { fetch } = fakeFetch((c) =>
      c.url.endsWith("/claim")
        ? { body: { claimed: false, pollAfterMs: 60_000 } }
        : {
            body: {
              runtimeInstanceId: "rti_test",
              receivedAt: "t",
              leaseExpiresAt: "t",
              channels: [],
            },
          },
    );
    // A poll-sleep that never resolves on its own — only stop() can end the idle
    // wait. If stop() did not interrupt it, this test would hang.
    const src = new HttpDeliverySource(
      cfg({ fetch, sleep: () => new Promise<void>(() => {}) }),
    );
    await src.start(async () => {});
    await new Promise((r) => setTimeout(r, 20));
    await src.stop();

    expect(true).toBe(true);
  });

  it("stop() returns promptly mid-turn and does not nack the in-flight delivery", async () => {
    const { fetch, calls } = fakeFetch((c) =>
      c.url.endsWith("/claim")
        ? { body: { claimed: true, delivery: claimedDelivery() } }
        : { body: {} },
    );
    // A long per-turn deadline: without an abort, stop() would block up to
    // turnTimeoutMs waiting for the in-flight turn.
    const src = new HttpDeliverySource(cfg({ fetch, turnTimeoutMs: 60_000 }));
    await src.start(async () => {
      await new Promise<void>(() => {});
    });
    await new Promise((r) => setTimeout(r, 20));
    await src.stop();

    // Shutting down leaves the lease for app-api to re-lease; the turn didn't
    // fail, so it must NOT be nacked.
    expect(calls.find((c) => c.url.includes("/fail"))).toBeUndefined();
  });
});

describe("HttpDeliverySource.getHistory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns [] without a request when threadTs is missing (root turn)", async () => {
    const { calls } = stubGlobalFetch(() => ({ json: { messages: [] } }));
    const src = new HttpDeliverySource(cfg({}));
    const history = await src.getHistory({ teamId: "T1", channel: "C1" }, 20);
    expect(history).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("maps role/text and sends teamId/channel/threadTs/limit in the query", async () => {
    const { calls } = stubGlobalFetch((url) => {
      expect(url).toBe(
        "http://x/api/channels/history?teamId=T1&channel=C1&threadTs=1.2&limit=5",
      );
      return {
        json: {
          messages: [
            { id: "m1", role: "user", text: "earlier question" },
            { id: "m2", role: "assistant", text: "earlier answer" },
          ],
        },
      };
    });
    const src = new HttpDeliverySource(cfg({}));
    const history = await src.getHistory(
      { teamId: "T1", channel: "C1", threadTs: "1.2" },
      5,
    );
    expect(history).toEqual([
      { id: "m1", role: "user", content: "earlier question" },
      { id: "m2", role: "assistant", content: "earlier answer" },
    ]);
    expect(calls).toHaveLength(1);
  });

  it("sends the Teams-shaped query (adapter/tenantId/conversationId) for a teams route", async () => {
    const { calls } = stubGlobalFetch((url) => {
      expect(url).toBe(
        "http://x/api/channels/history?adapter=teams&tenantId=tenant-1&conversationId=19%3Ac%40thread.tacv2%3Bmessageid%3D1&limit=5",
      );
      return { json: { messages: [{ id: "m1", role: "user", text: "hi" }] } };
    });
    const src = new HttpDeliverySource(cfg({}));
    const history = await src.getHistory(
      {
        adapter: "teams",
        tenantId: "tenant-1",
        conversationId: "19:c@thread.tacv2;messageid=1",
      } as unknown as Parameters<typeof src.getHistory>[0],
      5,
    );
    expect(history).toEqual([{ id: "m1", role: "user", content: "hi" }]);
    expect(calls).toHaveLength(1);
  });

  it("returns [] for a teams route missing tenantId/conversationId (no request)", async () => {
    const { calls } = stubGlobalFetch(() => ({ json: { messages: [] } }));
    const src = new HttpDeliverySource(cfg({}));
    const history = await src.getHistory(
      { adapter: "teams" } as unknown as Parameters<typeof src.getHistory>[0],
      5,
    );
    expect(history).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("hydrates a historical file ref into content parts (text inline + image data part)", async () => {
    const png = new Uint8Array([1, 2, 3, 4]);
    stubGlobalFetch((url) => {
      if (url.includes("/api/channels/history")) {
        return {
          json: {
            messages: [
              {
                id: "m1",
                role: "user",
                text: "what is this?",
                files: [
                  {
                    handle: "fileref_abc",
                    filename: "shot.png",
                    mimeType: "image/png",
                  },
                ],
              },
            ],
          },
        };
      }
      if (url.includes("/api/channels/files/fileref_abc")) {
        return { arrayBuffer: png.buffer, contentType: "image/png" };
      }
      throw new Error(`unexpected url in test: ${url}`);
    });
    const src = new HttpDeliverySource(cfg({}));
    const history = await src.getHistory(
      { teamId: "T1", channel: "C1", threadTs: "1.2" },
      20,
    );
    expect(history).toEqual([
      {
        id: "m1",
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          {
            type: "image",
            source: {
              type: "data",
              value: Buffer.from(png).toString("base64"),
              mimeType: "image/png",
            },
          },
        ],
      },
    ]);
  });

  it("returns [] and logs a quiet degradation on a transient 5xx history response", async () => {
    stubGlobalFetch(() => ({ status: 500 }));
    const logs: unknown[] = [];
    const src = new HttpDeliverySource(
      cfg({ log: (msg, meta) => logs.push({ msg, meta }) }),
    );
    const history = await src.getHistory(
      { teamId: "T1", channel: "C1", threadTs: "1.2" },
      20,
    );
    expect(history).toEqual([]);
    expect(logs.length).toBeGreaterThan(0);
    expect(String((logs[0] as { msg: string }).msg)).not.toMatch(
      /misconfigured/i,
    );
  });

  it("returns [] and logs a distinct misconfiguration warning on a 4xx history response", async () => {
    stubGlobalFetch(() => ({ status: 401 }));
    const logs: unknown[] = [];
    const src = new HttpDeliverySource(
      cfg({ log: (msg, meta) => logs.push({ msg, meta }) }),
    );
    const history = await src.getHistory(
      { teamId: "T1", channel: "C1", threadTs: "1.2" },
      20,
    );
    expect(history).toEqual([]);
    expect(logs.length).toBeGreaterThan(0);
    expect(String((logs[0] as { msg: string }).msg)).toMatch(
      /misconfigured\/unauthorized history endpoint/,
    );
  });

  it("returns [] and logs a quiet degradation on a 429 history response (not treated as misconfiguration)", async () => {
    stubGlobalFetch(() => ({ status: 429 }));
    const logs: unknown[] = [];
    const src = new HttpDeliverySource(
      cfg({ log: (msg, meta) => logs.push({ msg, meta }) }),
    );
    const history = await src.getHistory(
      { teamId: "T1", channel: "C1", threadTs: "1.2" },
      20,
    );
    expect(history).toEqual([]);
    expect(logs.length).toBeGreaterThan(0);
    expect(String((logs[0] as { msg: string }).msg)).not.toMatch(
      /misconfigured/i,
    );
  });

  it("returns [] when the history fetch throws (never fails the turn)", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    const src = new HttpDeliverySource(cfg({}));
    const history = await src.getHistory(
      { teamId: "T1", channel: "C1", threadTs: "1.2" },
      20,
    );
    expect(history).toEqual([]);
  });

  it("downloads inbound files from the channels file route", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { calls } = stubGlobalFetch((url) => {
      expect(url).toBe("http://x/api/channels/files/fileref_abc");
      return { arrayBuffer: bytes.buffer, contentType: "application/pdf" };
    });
    const src = new HttpDeliverySource(cfg({}));

    await expect(src.fetchFile("fileref_abc")).resolves.toEqual({
      bytes,
      mimeType: "application/pdf",
    });
    expect(calls).toEqual(["http://x/api/channels/files/fileref_abc"]);
  });

  it("uploads outbound files to the channels delivery route", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { requests } = stubGlobalFetch(() => ({
      json: { handle: "fileref_uploaded" },
    }));
    const src = new HttpDeliverySource(cfg({}));

    await expect(
      src.uploadFile("dlv_9", {
        bytes,
        filename: "report.pdf",
        title: "Report",
        altText: "Quarterly report",
      }),
    ).resolves.toEqual({ handle: "fileref_uploaded" });

    expect(requests[0]).toMatchObject({
      url: "http://x/api/channels/deliveries/dlv_9/files?filename=report.pdf&title=Report&altText=Quarterly+report",
      init: {
        method: "POST",
        headers: {
          authorization: "Bearer cpk-test",
          "content-type": "application/octet-stream",
        },
        body: bytes,
      },
    });
  });
});

describe("HttpRenderEventSink", () => {
  it("streams a render frame to the accept route with echoed scope (no deliveryId in body)", async () => {
    const { fetch, calls } = fakeFetch((c) =>
      c.url.endsWith("/claim")
        ? { body: { claimed: true, delivery: claimedDelivery() } }
        : {
            body: {
              idempotencyKey: "turn_9:main:0",
              acceptance: "accepted",
            },
          },
    );
    const conf = cfg({ fetch });
    const src = new HttpDeliverySource(conf);
    await src.claimOnce(); // populates per-delivery scope
    const sink = new HttpRenderEventSink(conf, src);

    const receipt = await sink.push({
      deliveryId: "dlv_9",
      turnId: "turn_9",
      slot: "main",
      seq: 0,
      event: { kind: "text_delta", messageId: "m1", delta: "hi" },
    });

    expect(receipt).toEqual({
      idempotencyKey: "turn_9:main:0",
      acceptance: "accepted",
    });
    const accept = calls.find((c) =>
      c.url.endsWith("/api/channels/deliveries/dlv_9/render-events/accept"),
    )!;
    expect(accept.body).toMatchObject({
      organizationId: "org_1",
      projectId: 7,
      channelId: "channel_1",
      channelName: "opentagbot",
      turnId: "turn_9",
      runtimeInstanceId: "rti_test",
      slot: "main",
      seq: 0,
      idempotencyKey: "turn_9:main:0",
      event: { kind: "text_delta", messageId: "m1", delta: "hi" },
      // OSS-446: the render-accept is fenced on the claim's lease token.
      leaseToken: "lease_z",
    });
    // The accept route rejects a body that also carries deliveryId.
    expect("deliveryId" in accept.body).toBe(false);
  });

  it("throws when no leased scope exists for the delivery", async () => {
    const { fetch } = fakeFetch(() => ({ body: {} }));
    const src = new HttpDeliverySource(cfg({ fetch }));
    const sink = new HttpRenderEventSink(cfg({ fetch }), src);
    await expect(
      sink.push({
        deliveryId: "dlv_unknown",
        turnId: "turn_9",
        slot: "main",
        seq: 0,
        event: { kind: "run_started" },
      }),
    ).rejects.toThrow(/no leased scope/);
  });
});

describe("intelligenceAdapter() — config-free default transports", () => {
  it("is callable with zero arguments (config-free)", () => {
    // Compile-time + runtime guard: intelligenceAdapter() must take no required
    // args so consumers can write createChannel({ adapters: [intelligenceAdapter()] }).
    const adapter = intelligenceAdapter();
    expect(adapter.platform).toBe("intelligence");
  });

  it("builds HTTP transports and uses the bot name as the declared channel name", async () => {
    const { fetch, calls } = fakeFetch((c) =>
      c.url.endsWith("/heartbeat")
        ? {
            body: {
              runtimeInstanceId: "rti_test",
              receivedAt: "t",
              leaseExpiresAt: "t",
              channels: [],
            },
          }
        : { body: { claimed: false, pollAfterMs: 60000 } },
    );
    const bot = createChannel({
      name: "opentagbot",
      agent: () => new FakeAgent(),
      // No source/egress injected -> default HTTP transports; no channelName in
      // config -> it comes from createChannel({ name }) via the start() context.
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
      declaredChannels: [{ channelName: "opentagbot", adapter: "slack" }],
    });
    expect(calls.some((c) => c.url.endsWith("/claim"))).toBe(true);
  });
});
