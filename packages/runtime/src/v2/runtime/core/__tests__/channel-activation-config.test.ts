import { describe, it, expect } from "vitest";
import { createChannel } from "@copilotkit/channels";
import { CopilotKitIntelligence } from "../../intelligence-platform";
import {
  ChannelConfigError,
  parseProjectIdFromApiKey,
  deriveChannelActivationConfig,
} from "../channel-activation-config";

function fakeIntelligence(apiKey: string): CopilotKitIntelligence {
  return new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey,
  });
}

describe("parseProjectIdFromApiKey", () => {
  it("parses the project id out of a well-formed Intelligence API key", () => {
    expect(parseProjectIdFromApiKey("cpk-42_short_long")).toBe(42);
  });

  it("throws ChannelConfigError naming the expected format for a wrong prefix", () => {
    expect(() => parseProjectIdFromApiKey("sk-live_x_y")).toThrow(
      ChannelConfigError,
    );
    expect(() => parseProjectIdFromApiKey("sk-live_x_y")).toThrow(
      /cpk-\{projectId\}/,
    );
  });

  it("throws ChannelConfigError for an empty project id segment", () => {
    expect(() => parseProjectIdFromApiKey("cpk-_short_long")).toThrow(
      ChannelConfigError,
    );
  });

  it("redacts the API key: the error names the format but never echoes the full secret", () => {
    const secret = "sk-live_TOPSECRETKEYMATERIAL_should_never_be_logged";
    const err = (() => {
      try {
        parseProjectIdFromApiKey(secret);
        return undefined;
      } catch (e) {
        return e as Error;
      }
    })();

    expect(err).toBeInstanceOf(ChannelConfigError);
    expect(err!.message).toMatch(/cpk-\{projectId\}/);
    expect(err!.message).not.toContain(secret);
    expect(err!.message).not.toContain("TOPSECRETKEYMATERIAL");
  });

  it("does not leak the secret tail of a cpk-_-shaped key while still naming the format (RC12)", () => {
    // The secret starts immediately after the fixed `cpk-` namespace, so a
    // fixed-width prefix slice (the old `apiKey.slice(0, 8)`) would echo the
    // first secret bytes ("ZZSEC…") — the distinctive marker below makes even a
    // 3-char leak detectable.
    const err = (() => {
      try {
        parseProjectIdFromApiKey("cpk-_ZZSECRETZZ_x");
        return undefined;
      } catch (e) {
        return e as Error;
      }
    })();

    expect(err).toBeInstanceOf(ChannelConfigError);
    expect(err!.message).toMatch(/cpk-\{projectId\}/);
    expect(err!.message).not.toContain("ZZSECRETZZ");
    expect(err!.message).not.toContain("ZZS");
    expect(err!.message).not.toContain("ZZ");
  });
});

describe("deriveChannelActivationConfig", () => {
  it("resolves all six fields from the intelligence config and channel", () => {
    const intelligence = fakeIntelligence("cpk-42_short_long");
    const channel = createChannel({ name: "support" });

    const config = deriveChannelActivationConfig({
      intelligence,
      channel,
      runtimeInstanceId: "rti_x",
    });

    expect(config).toEqual({
      wsUrl: intelligence.ɵgetRunnerWsUrl(),
      apiKey: intelligence.ɵgetRunnerAuthToken(),
      projectId: 42,
      channelName: "support",
      adapter: "slack",
      runtimeInstanceId: "rti_x",
    });
  });

  it("uses the explicit adapter when provided", () => {
    const intelligence = fakeIntelligence("cpk-7_a_b");
    const channel = createChannel({ name: "support" });

    const config = deriveChannelActivationConfig({
      intelligence,
      channel,
      adapter: "teams",
      runtimeInstanceId: "rti_y",
    });

    expect(config.adapter).toBe("teams");
  });

  it("throws ChannelConfigError when the channel has no name", () => {
    const intelligence = fakeIntelligence("cpk-42_short_long");
    const channel = createChannel({});

    expect(() =>
      deriveChannelActivationConfig({
        intelligence,
        channel,
        runtimeInstanceId: "rti_x",
      }),
    ).toThrow(ChannelConfigError);
  });

  it.each([
    ["Slack", "uppercase"],
    ["support_bot", "underscore"],
    ["cs", "too short"],
    ["a".repeat(65), "too long (65 chars)"],
  ])(
    "rejects a channel name that is not lowercase kebab-case in 3–64 chars: %s (%s) (RC13)",
    (name) => {
      const intelligence = fakeIntelligence("cpk-42_short_long");
      const channel = createChannel({ name });

      const call = () =>
        deriveChannelActivationConfig({
          intelligence,
          channel,
          runtimeInstanceId: "rti_x",
        });

      expect(call).toThrow(ChannelConfigError);
      expect(call).toThrow(/lowercase kebab-case/);
    },
  );

  it("accepts a valid lowercase kebab-case channel name (RC13)", () => {
    const intelligence = fakeIntelligence("cpk-42_short_long");
    const channel = createChannel({ name: "support" });

    const config = deriveChannelActivationConfig({
      intelligence,
      channel,
      runtimeInstanceId: "rti_x",
    });

    expect(config.channelName).toBe("support");
  });
});
