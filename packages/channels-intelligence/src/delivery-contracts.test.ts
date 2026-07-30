import { expect, test } from "vitest";
import {
  CHANNEL_DELIVERY_PROTOCOL,
  assertDeliveryPacket,
} from "./delivery-contracts.js";
import type {
  ChannelDeliveryPacket,
  ChannelProviderPayload,
} from "./delivery-contracts.js";

const appendPayload = (): ChannelProviderPayload => ({
  kind: "slack.stream.append",
  providerReference: "pref_v1_reference_01",
  delta: "Hello",
  beforeTextDigest:
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  afterTextDigest:
    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
});

const packet = (): ChannelDeliveryPacket => {
  return {
    protocol: CHANNEL_DELIVERY_PROTOCOL,
    deliveryId: "dlv_delivery_01",
    runtimeInstanceId: "rti_runtime_01",
    ownerGeneration: 1,
    seq: 0,
    packetId: "pkt_01",
    payload: appendPayload(),
  };
};

test("uses the hard-cut realtime delivery protocol", () => {
  expect(CHANNEL_DELIVERY_PROTOCOL).toBe("channel_delivery_v1");
});

test("accepts one destination-free packet", () => {
  expect(() => assertDeliveryPacket(packet())).not.toThrow();
});

test("rejects trusted addressing and credentials", () => {
  const forged = {
    ...packet(),
    payload: {
      ...appendPayload(),
      channel: "C_FORGED",
      token: "xoxb-secret",
    },
  };

  expect(() => assertDeliveryPacket(forged)).toThrow(
    "delivery payload is invalid",
  );
});

test("accepts valid provider payload numbers without a cross-language digest", () => {
  const numericPacket = {
    ...packet(),
    payload: {
      kind: "teams.message.create",
      text: "numeric values",
      cards: [{ small: 1e-7, negativeZero: -0, large: 1e23 }],
    },
  };

  expect(() => assertDeliveryPacket(numericPacket)).not.toThrow();
});

test("rejects per-packet auth and heartbeat shapes", () => {
  expect(() =>
    assertDeliveryPacket({
      ...packet(),
      authToken: "cpk-retired-per-packet-auth",
    }),
  ).toThrow("delivery packet fields are invalid");
  expect(() =>
    assertDeliveryPacket({
      ...packet(),
      payload: { kind: "channel.heartbeat" },
    }),
  ).toThrow("delivery payload is invalid");
});

test("enforces the shared identifier and provider-reference bounds", () => {
  expect(() =>
    assertDeliveryPacket({
      ...packet(),
      deliveryId: "dlv_short",
    }),
  ).toThrow("delivery packet fields are invalid");
  expect(() =>
    assertDeliveryPacket({
      ...packet(),
      packetId: `pkt_${"x".repeat(129)}`,
    }),
  ).toThrow("delivery packet fields are invalid");

  expect(() =>
    assertDeliveryPacket({
      ...packet(),
      payload: {
        ...appendPayload(),
        providerReference: "pref_v1_short",
      },
    }),
  ).toThrow("delivery payload is invalid");
});

test("rejects packets over 64 KiB", () => {
  expect(() =>
    assertDeliveryPacket({
      ...packet(),
      payload: {
        kind: "slack.message.create" as const,
        text: "",
        blocks: [{ text: "x".repeat(40_000) }, { text: "y".repeat(40_000) }],
      },
    }),
  ).toThrow("delivery packet exceeds 64 KiB");
});
