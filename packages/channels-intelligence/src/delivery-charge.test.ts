import { FakeAgent } from "@copilotkit/channels-core";
import { expect, test, vi } from "vitest";
import { DeliveryAdapter } from "./delivery-adapter.js";
import { ChannelDeliveryChargeClient } from "./delivery-charge.js";
import { ClaimedChannelDelivery } from "./delivery-transport.js";
import type { PreparedChannelDelivery } from "./delivery-transport.js";

const delivery: PreparedChannelDelivery = {
  protocol: "channel_delivery_v1",
  deliveryId: "dlv_charge_delivery",
  deliveryExpiresAt: "2099-07-30T20:00:00.000Z",
  canonicalThreadId: "thread_charge",
  appUserId: "slack:T1:U1",
  channelId: "channel_charge",
  channelName: "support",
  adapter: "slack",
  turn: {
    eventId: "evt_charge",
    receivedAt: "2026-07-30T20:00:00.000Z",
    input: {
      kind: "text",
      text: "hello",
      operation: {
        kind: "created",
        logicalMessageId: "message_charge",
        revisionId: "revision_charge",
        mentioned: true,
      },
    },
    actor: { externalUserId: "U1" },
  },
};

test("charge client calls the delivery-scoped runtime route", async () => {
  const fetch = vi.fn(async () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          charged: true,
          metering: { mode: "finite", lifetimeUsed: 1, lifetimeLimit: 500 },
        }),
      ),
    ),
  );
  const client = new ChannelDeliveryChargeClient({
    baseUrl: "https://api.example/",
    apiKey: "cpk-runtime",
    fetch,
  });

  await expect(client.charge(delivery.deliveryId)).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    "https://api.example/api/channels/deliveries/dlv_charge_delivery/charge",
    {
      method: "POST",
      headers: { authorization: "Bearer cpk-runtime" },
    },
  );
});

test("one claimed delivery shares one charge across substantive effects", async () => {
  const charge = vi.fn(async () => undefined);
  const channel = {
    joinReply: delivery,
    push: vi.fn(async (_event: string, packet: any) => ({
      deliveryId: packet.deliveryId,
      seq: packet.seq,
      packetId: packet.packetId,
      phase: "applied",
      result: {},
    })),
    on: vi.fn(),
    onClose: vi.fn(),
    leave: vi.fn(),
  };
  const claimed = new ClaimedChannelDelivery(
    delivery,
    { ownerGeneration: 1, runtimeInstanceId: "rti_charge_01" },
    channel,
    vi.fn(),
    undefined,
    undefined,
    new AbortController().signal,
    { charge },
  );

  await claimed.effect("response_1", {
    kind: "slack.message.create",
    text: "first",
  });
  await claimed.effect("response_2", {
    kind: "slack.message.create",
    text: "second",
  });

  expect(charge).toHaveBeenCalledOnce();
  expect(channel.push).toHaveBeenCalledTimes(2);
});

test("Slack status is unmetered and does not count as provider output", async () => {
  const charge = vi.fn(async () => undefined);
  const channel = {
    joinReply: delivery,
    push: vi.fn(async (_event: string, packet: any) => ({
      deliveryId: packet.deliveryId,
      seq: packet.seq,
      packetId: packet.packetId,
      phase: "applied",
      result: {},
    })),
    on: vi.fn(),
    onClose: vi.fn(),
    leave: vi.fn(),
  };
  const claimed = new ClaimedChannelDelivery(
    delivery,
    { ownerGeneration: 1, runtimeInstanceId: "rti_charge_01" },
    channel,
    vi.fn(),
    undefined,
    undefined,
    new AbortController().signal,
    { charge },
  );

  await claimed.effect(
    "response_status",
    { kind: "slack.thread.status", status: "is thinking…" },
    { charge: false },
  );

  expect(charge).not.toHaveBeenCalled();
  expect(claimed.hasProviderOutput()).toBe(false);
});

test("agent work charges before the canonical run", async () => {
  const order: string[] = [];
  const claimed = {
    charge: vi.fn(async () => {
      order.push("charge");
    }),
  } as unknown as ClaimedChannelDelivery;
  const adapter = new DeliveryAdapter({
    channelName: "support",
    transport: {} as never,
    loadHistory: async () => [],
    runCanonical: async () => {
      order.push("run");
      return { iterations: 0, interrupted: false };
    },
  });

  await adapter.runAgentLifecycle({
    replyTarget: { claimedDelivery: claimed, delivery },
    agent: new FakeAgent(),
    renderer: {} as never,
    tools: [],
    context: [],
    execute: vi.fn(),
  });

  expect(order).toEqual(["charge", "run"]);
});
