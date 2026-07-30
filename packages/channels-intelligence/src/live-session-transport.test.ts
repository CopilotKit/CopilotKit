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

type ObservedPromiseState =
  | { status: "pending" }
  | { status: "resolved" }
  | { status: "rejected"; error: unknown };

const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const observePromiseState = async (
  promise: Promise<unknown>,
): Promise<ObservedPromiseState> => {
  let state: ObservedPromiseState = { status: "pending" };
  void promise.then(
    () => {
      state = { status: "resolved" };
    },
    (error: unknown) => {
      state = { status: "rejected", error };
    },
  );
  await Promise.resolve();
  return state;
};

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

test("effect rejects a provider kind that does not match the admitted adapter", async () => {
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
      kind: "teams.message.create",
      text: "forged cross-provider effect",
    }),
  ).rejects.toThrow("provider effect adapter does not match delivery");

  expect(push).not.toHaveBeenCalled();
  session.leave();
});

test("effect rejects the 257th pending provider effect with a stable backpressure error", async () => {
  const firstPush = deferred<unknown>();
  const push = vi
    .fn<RealtimeGatewayDeliveryChannel["push"]>()
    .mockImplementation(async () => firstPush.promise);
  const session = new LiveDeliverySession(
    delivery(),
    "runtime_01",
    deliveryChannel(push),
    undefined,
    60_000,
  );
  const accepted = Array.from({ length: 256 }, (_, index) =>
    session.effect("response_01", {
      kind: "slack.message.create",
      text: `message ${index}`,
    }),
  );

  const overflow = session.effect("response_01", {
    kind: "slack.message.create",
    text: "one too many",
  });
  const admissionOutcome = await observePromiseState(overflow);

  firstPush.resolve({ receivedThrough: 0, appliedThrough: 0 });
  await Promise.all(accepted);
  session.leave();

  expect(admissionOutcome).toMatchObject({
    status: "rejected",
    error: {
      name: "ChannelDeliveryBackpressureError",
      code: "delivery_backpressure_exceeded",
      message: "channel delivery provider-effect backpressure exceeded",
    },
  });
  expect(push).toHaveBeenCalledTimes(256);
});

test("effect admits a replacement after one pending operation settles", async () => {
  const firstPush = deferred<unknown>();
  const secondPush = deferred<unknown>();
  const cursor = { receivedThrough: 0, appliedThrough: 0 };
  const push = vi
    .fn<RealtimeGatewayDeliveryChannel["push"]>()
    .mockImplementationOnce(async () => firstPush.promise)
    .mockImplementationOnce(async () => secondPush.promise)
    .mockResolvedValue(cursor);
  const session = new LiveDeliverySession(
    delivery(),
    "runtime_01",
    deliveryChannel(push),
    undefined,
    60_000,
  );
  const accepted = Array.from({ length: 256 }, (_, index) =>
    session.effect("response_01", {
      kind: "slack.message.create",
      text: `message ${index}`,
    }),
  );
  const overflow = session.effect("response_01", {
    kind: "slack.message.create",
    text: "blocked while full",
  });
  await expect(overflow).rejects.toMatchObject({
    code: "delivery_backpressure_exceeded",
  });

  firstPush.resolve(cursor);
  await accepted[0];
  await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(2));
  const replacement = session.effect("response_01", {
    kind: "slack.message.create",
    text: "accepted after one settles",
  });
  const admissionOutcome = await observePromiseState(replacement);

  secondPush.resolve(cursor);
  const settlements = await Promise.allSettled([...accepted, replacement]);
  session.leave();

  expect(admissionOutcome.status).toBe("pending");
  expect(settlements.at(-1)).toEqual({ status: "fulfilled", value: cursor });
});

test("effect caps pending encoded envelope bytes and releases them after settle", async () => {
  const firstPush = deferred<unknown>();
  const secondPush = deferred<unknown>();
  const cursor = { receivedThrough: 0, appliedThrough: 0 };
  const push = vi
    .fn<RealtimeGatewayDeliveryChannel["push"]>()
    .mockImplementationOnce(async () => firstPush.promise)
    .mockImplementationOnce(async () => secondPush.promise)
    .mockResolvedValue(cursor);
  const session = new LiveDeliverySession(
    delivery(),
    "runtime_01",
    deliveryChannel(push),
    undefined,
    60_000,
  );
  const text = "x".repeat(64_000);
  const accepted = Array.from({ length: 4 }, () =>
    session.effect("response_01", {
      kind: "slack.message.create",
      text,
    }),
  );

  const overflow = session.effect("response_01", {
    kind: "slack.message.create",
    text,
  });
  const overflowAdmissionOutcome = await observePromiseState(overflow);

  firstPush.resolve(cursor);
  await accepted[0];
  await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(2));
  const replacement = session.effect("response_01", {
    kind: "slack.message.create",
    text,
  });
  const replacementAdmissionOutcome = await observePromiseState(replacement);

  secondPush.resolve(cursor);
  const settlements = await Promise.allSettled([
    ...accepted,
    overflow,
    replacement,
  ]);
  session.leave();

  expect(overflowAdmissionOutcome.status).toBe("rejected");
  expect(settlements.at(-2)).toMatchObject({
    status: "rejected",
    reason: { code: "delivery_backpressure_exceeded" },
  });
  expect(replacementAdmissionOutcome.status).toBe("pending");
  expect(settlements.at(-1)).toEqual({ status: "fulfilled", value: cursor });
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
  expect(log).toHaveBeenCalledWith("channel delivery topic join failed", {
    deliveryId: "dlv_delivery",
    errorCategory: "unknown",
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("join denied");
});

test("delivery handler failure logs only a bounded error category", async () => {
  let notice: ((payload: unknown) => void) | undefined;
  const channel = deliveryChannel(vi.fn().mockResolvedValue({}));
  const session: RealtimeGatewaySession = {
    push: vi.fn(),
    on: (_event, handler) => {
      notice = handler;
    },
    join: vi.fn().mockResolvedValue(channel),
  };
  const log = vi.fn();
  const transport = new LiveSessionTransport({
    session,
    runtimeInstanceId: "runtime_01",
    log,
  });
  transport.start(async () => {
    throw new Error(
      "provider body secret-body with opaque ref pref_v1_secret-reference",
    );
  });

  notice?.(delivery());
  await transport.stop();

  expect(log).toHaveBeenCalledWith("channel delivery handler failed", {
    deliveryId: "dlv_delivery",
    errorCategory: "unknown",
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret-body");
  expect(JSON.stringify(log.mock.calls)).not.toContain(
    "pref_v1_secret-reference",
  );
});

test("delivery failure-record rejection logs only a bounded error category", async () => {
  let notice: ((payload: unknown) => void) | undefined;
  const channel = deliveryChannel(
    vi.fn(async (event) => {
      if (event === "channel.delivery.fail.v1") {
        throw new Error("provider response secret-failure-body");
      }
      return {};
    }),
  );
  const session: RealtimeGatewaySession = {
    push: vi.fn(),
    on: (_event, handler) => {
      notice = handler;
    },
    join: vi.fn().mockResolvedValue(channel),
  };
  const log = vi.fn();
  const transport = new LiveSessionTransport({
    session,
    runtimeInstanceId: "runtime_01",
    log,
  });
  transport.start(async () => {
    throw new Error("handler failed");
  });

  notice?.(delivery());
  await transport.stop();

  expect(log).toHaveBeenCalledWith(
    "channel delivery failure could not be recorded",
    {
      deliveryId: "dlv_delivery",
      errorCategory: "unknown",
    },
  );
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret-failure-body");
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
