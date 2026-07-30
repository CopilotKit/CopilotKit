import { describe, expect, it } from "vitest";
import {
  CHANNEL_DELIVERY_PROTOCOL,
  assertDeliveryPacket,
  deliveryPayloadDigest,
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
  const payload = appendPayload();
  return {
    protocol: CHANNEL_DELIVERY_PROTOCOL,
    deliveryId: "dlv_delivery_01",
    runtimeInstanceId: "rti_runtime_01",
    ownerGeneration: 1,
    seq: 0,
    effectId: "eff_01",
    responseId: "response_01",
    payloadDigest: deliveryPayloadDigest(payload),
    payload,
  };
};

describe("Channel delivery packet contract", () => {
  it("uses the hard-cut realtime delivery protocol", () => {
    expect(CHANNEL_DELIVERY_PROTOCOL).toBe("channel_delivery_v1");
  });

  it("accepts one destination-free packet", () => {
    expect(() => assertDeliveryPacket(packet())).not.toThrow();
  });

  it("rejects trusted addressing and credentials", () => {
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

  it("rejects a changed payload under the same digest", () => {
    const changed = {
      ...packet(),
      payload: { ...appendPayload(), delta: "changed" },
    };

    expect(() => assertDeliveryPacket(changed)).toThrow(
      "delivery payload digest is invalid",
    );
  });

  it("rejects per-packet auth and heartbeat shapes", () => {
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

  it("enforces the shared identifier and provider-reference bounds", () => {
    expect(() =>
      assertDeliveryPacket({
        ...packet(),
        deliveryId: "dlv_short",
      }),
    ).toThrow("delivery packet fields are invalid");
    expect(() =>
      assertDeliveryPacket({
        ...packet(),
        effectId: `eff_${"x".repeat(129)}`,
      }),
    ).toThrow("delivery packet fields are invalid");

    const payload = {
      ...appendPayload(),
      providerReference: "pref_v1_short",
    };
    expect(() =>
      assertDeliveryPacket({
        ...packet(),
        payload,
        payloadDigest: deliveryPayloadDigest(payload),
      }),
    ).toThrow("delivery payload is invalid");
  });

  it("rejects packets over 64 KiB", () => {
    const payload = {
      kind: "slack.message.create" as const,
      text: "",
      blocks: [{ text: "x".repeat(40_000) }, { text: "y".repeat(40_000) }],
    };

    expect(() =>
      assertDeliveryPacket({
        ...packet(),
        payload,
        payloadDigest: deliveryPayloadDigest(payload),
      }),
    ).toThrow("delivery packet exceeds 64 KiB");
  });
});
