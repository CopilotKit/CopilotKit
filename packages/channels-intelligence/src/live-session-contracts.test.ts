import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CHANNEL_SESSION_PROTOCOL,
  assertProviderEffect,
  providerEffectByteLength,
} from "./live-session-contracts.js";
import type { ChannelProviderEffect } from "./live-session-contracts.js";

const canonicalJson = (value: unknown): string =>
  JSON.stringify(
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        )
      : value,
  );

const slackAppendEffect = (): ChannelProviderEffect => {
  const unsigned = {
    kind: "slack.stream.append" as const,
    effectId: "eff_01",
    seq: 1,
    responseId: "response_01",
    delta: "Hello",
    beforeTextDigest:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    afterTextDigest:
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  };
  return {
    ...unsigned,
    payloadDigest: createHash("sha256")
      .update(canonicalJson(unsigned))
      .digest("hex"),
  };
};

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

  it("rejects missing required fields and unknown provider identifiers", () => {
    const missingFinalDigest = {
      kind: "slack.stream.stop",
      effectId: "eff_01",
      seq: 2,
      responseId: "response_01",
      payloadDigest:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const rawMessageId = {
      ...slackAppendEffect(),
      messageId: "1712345678.123456",
    };

    expect(() => assertProviderEffect(missingFinalDigest)).toThrow(
      "provider effect payload is invalid",
    );
    expect(() => assertProviderEffect(rawMessageId)).toThrow(
      "provider effect payload is invalid",
    );
  });

  it("rejects a payload changed after its digest was signed", () => {
    const tampered = {
      ...slackAppendEffect(),
      delta: "Changed after signing",
    };

    expect(() => assertProviderEffect(tampered)).toThrow(
      "provider effect payload digest is invalid",
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
