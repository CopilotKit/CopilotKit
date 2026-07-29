import { describe, expect, it } from "vitest";
import {
  CHANNEL_SESSION_PROTOCOL,
  assertProviderEffect,
  providerEffectByteLength,
} from "./live-session-contracts.js";
import type { ChannelProviderEffect } from "./live-session-contracts.js";

const slackAppendEffect = (): ChannelProviderEffect => ({
  kind: "slack.stream.append",
  effectId: "eff_01",
  seq: 1,
  responseId: "response_01",
  payloadDigest:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  delta: "Hello",
  beforeTextDigest:
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  afterTextDigest:
    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
});

describe("Live Sessions provider-effect contract", () => {
  it("uses the one stable V1 protocol name", () => {
    expect(CHANNEL_SESSION_PROTOCOL).toBe("channel_session_v1");
  });

  it("accepts a destination-free Slack append effect", () => {
    const effect = slackAppendEffect();

    expect(() => assertProviderEffect(effect)).not.toThrow();
    expect(providerEffectByteLength(effect)).toBeGreaterThan(0);
  });

  it("rejects credentials and trusted addressing at the SDK boundary", () => {
    const forgedEffect = {
      ...slackAppendEffect(),
      channel: "C_FORGED",
      token: "xoxb-secret",
    };

    expect(() => assertProviderEffect(forgedEffect)).toThrow(
      "provider effect contains a trusted field",
    );
  });

  it("rejects envelopes larger than 64 KiB", () => {
    const oversizedEffect = {
      ...slackAppendEffect(),
      delta: "x".repeat(64 * 1024),
    };

    expect(() => assertProviderEffect(oversizedEffect)).toThrow(
      "provider effect exceeds 64 KiB",
    );
  });
});
