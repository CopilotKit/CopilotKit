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
});
