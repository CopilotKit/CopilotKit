import { expect, test, vi } from "vitest";
import {
  CHANNEL_SESSION_PROTOCOL,
  PROVIDER_EFFECT_MAX_BYTES,
  providerEffectByteLength,
} from "./live-session-contracts.js";
import {
  LiveDeliverySession,
  LiveSessionTransport,
} from "./live-session-transport.js";
import type { LiveSessionDelivery } from "./live-session-transport.js";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";

const delivery = (): LiveSessionDelivery => ({
  protocol: CHANNEL_SESSION_PROTOCOL,
  deliveryId: "dlv_delivery",
  deliveryCode: "dcode_short_lived",
  sessionTopic: "channel_session:dlv_delivery",
  canonicalThreadId: "thread_01",
  appUserId: "user_01",
  channelId: "channel_01",
  adapter: "slack",
  turn: {
    id: "turn_01",
    eventId: "event_01",
    receivedAt: "2026-07-29T00:00:00.000Z",
    input: { kind: "text", text: "hello" },
  },
});

const deliveryChannel = (
  push: RealtimeGatewayDeliveryChannel["push"],
): RealtimeGatewayDeliveryChannel => ({
  push,
  on: vi.fn(),
  leave: vi.fn(),
});

test("effect retries the same envelope after an ambiguous push failure", async () => {
  const push = vi
    .fn<RealtimeGatewayDeliveryChannel["push"]>()
    .mockRejectedValueOnce(new Error("socket dropped"))
    .mockResolvedValueOnce({ receivedThrough: 0, appliedThrough: 0 });
  const channel = deliveryChannel(push);
  const session = new LiveDeliverySession(
    delivery(),
    "runtime_01",
    channel,
    undefined,
    60_000,
  );

  const result = await session.effect("response_01", {
    kind: "slack.message.create",
    text: "hello",
  });

  expect(result).toEqual({ receivedThrough: 0, appliedThrough: 0 });
  expect(push).toHaveBeenCalledTimes(2);
  expect(push.mock.calls[1]).toEqual(push.mock.calls[0]);
  session.leave();
});

test("effect rejects a wrapped envelope over 64 KiB before pushing", async () => {
  const representativeEffect = {
    kind: "slack.message.create" as const,
    effectId: `eff_${"a".repeat(32)}`,
    seq: 0,
    responseId: "response_01",
    payloadDigest: "a".repeat(64),
    text: "",
  };
  const text = "x".repeat(
    PROVIDER_EFFECT_MAX_BYTES -
      providerEffectByteLength(representativeEffect) -
      10,
  );
  const push = vi
    .fn<RealtimeGatewayDeliveryChannel["push"]>()
    .mockResolvedValue({ receivedThrough: 0, appliedThrough: 0 });
  const session = new LiveDeliverySession(
    delivery(),
    "runtime_01",
    deliveryChannel(push),
    undefined,
    60_000,
  );

  await expect(
    session.effect("response_01", {
      kind: "slack.message.create",
      text,
    }),
  ).rejects.toThrow("provider effect envelope exceeds 64 KiB");

  expect(push).not.toHaveBeenCalled();
  session.leave();
});

test("run close waits until every accepted provider effect settles", async () => {
  let resolveEffect: ((value: unknown) => void) | undefined;
  const effectResult = new Promise((resolve) => {
    resolveEffect = resolve;
  });
  const events: string[] = [];
  const push = vi.fn<RealtimeGatewayDeliveryChannel["push"]>(
    async (event): Promise<unknown> => {
      events.push(event);
      if (event === "channel.effect.v1") return effectResult;
      return {};
    },
  );
  const session = new LiveDeliverySession(
    delivery(),
    "runtime_01",
    deliveryChannel(push),
    undefined,
    60_000,
  );

  const effect = session.effect("response_01", {
    kind: "slack.message.create",
    text: "hello",
  });
  const close = session.closeRun("call_01", "complete");
  await vi.waitFor(() => expect(events).toEqual(["channel.effect.v1"]));

  resolveEffect?.({ receivedThrough: 0, appliedThrough: 0 });
  await effect;
  await close;

  expect(events).toEqual(["channel.effect.v1", "channel.run.close.v1"]);
  session.leave();
});

test("run cancellation aborts only the active matching delivery and call", async () => {
  const handlers = new Map<string, (payload: unknown) => void>();
  const channel: RealtimeGatewayDeliveryChannel = {
    push: vi.fn(async (event, payload) => {
      if (event !== "channel.run.open.v1") return {};
      const request = payload as { callId: string; responseId: string };
      return {
        deliveryId: "dlv_delivery",
        callId: request.callId,
        responseId: request.responseId,
        threadId: "thread_01",
        runId: `run_${request.callId}`,
        runnerToken: "rnr_test",
        runnerTokenExpiresAt: "2026-07-29T00:05:00.000Z",
      };
    }),
    on: (event, handler) => {
      handlers.set(event, handler);
    },
    leave: vi.fn(),
  };
  const session = new LiveDeliverySession(
    delivery(),
    "runtime_01",
    channel,
    undefined,
    60_000,
  );

  const first = await session.openRun({
    callId: "call_first",
    responseId: "response_first",
    agentId: "support",
  });
  const cancel = handlers.get("channel.run.cancel.v1");
  expect(cancel).toBeDefined();

  cancel?.({
    protocol: CHANNEL_SESSION_PROTOCOL,
    deliveryId: "dlv_other",
    callId: "call_first",
    reason: "gateway_drain_timeout",
  });
  cancel?.({
    protocol: CHANNEL_SESSION_PROTOCOL,
    deliveryId: "dlv_delivery",
    callId: "call_stale",
    reason: "gateway_drain_timeout",
  });
  expect(first.abortSignal.aborted).toBe(false);

  await session.closeRun("call_first", "complete");
  const second = await session.openRun({
    callId: "call_second",
    responseId: "response_second",
    agentId: "support",
  });
  cancel?.({
    protocol: CHANNEL_SESSION_PROTOCOL,
    deliveryId: "dlv_delivery",
    callId: "call_first",
    reason: "gateway_drain_timeout",
  });
  expect(second.abortSignal.aborted).toBe(false);

  cancel?.({
    protocol: CHANNEL_SESSION_PROTOCOL,
    deliveryId: "dlv_delivery",
    callId: "call_second",
    reason: "gateway_drain_timeout",
  });
  expect(second.abortSignal.aborted).toBe(true);
  expect(second.abortSignal.reason).toBe("gateway_drain_timeout");
  session.leave();
});

test("delivery-topic join rejection is logged and does not reject transport stop", async () => {
  let notice: ((payload: unknown) => void) | undefined;
  const session: RealtimeGatewaySession = {
    push: vi.fn(),
    on: (_event, handler) => {
      notice = handler;
    },
    join: vi.fn().mockRejectedValue(new Error("join denied")),
  };
  const log = vi.fn();
  const handler = vi.fn();
  const transport = new LiveSessionTransport({
    session,
    runtimeInstanceId: "runtime_01",
    log,
  });
  transport.start(handler);

  notice?.(delivery());
  await transport.stop();

  expect(handler).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith(
    "channel delivery topic join failed",
    expect.objectContaining({
      deliveryId: "dlv_delivery",
      error: "join denied",
    }),
  );
});

test("delivery-topic join presents the short-lived admitted delivery code", async () => {
  let notice: ((payload: unknown) => void) | undefined;
  const channel = deliveryChannel(vi.fn().mockResolvedValue({}));
  const session: RealtimeGatewaySession = {
    push: vi.fn(),
    on: (_event, handler) => {
      notice = handler;
    },
    join: vi.fn().mockResolvedValue(channel),
  };
  const transport = new LiveSessionTransport({
    session,
    runtimeInstanceId: "runtime_01",
  });
  transport.start(async () => undefined);

  notice?.({ ...delivery(), deliveryCode: "dcode_short_lived" });
  await transport.stop();

  expect(session.join).toHaveBeenCalledWith("channel_session:dlv_delivery", {
    protocol: CHANNEL_SESSION_PROTOCOL,
    runtimeInstanceId: "runtime_01",
    deliveryCode: "dcode_short_lived",
  });
});
