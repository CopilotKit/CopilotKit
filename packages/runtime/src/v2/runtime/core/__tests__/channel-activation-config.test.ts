import { describe, it, expect } from "vitest";
import { createChannel } from "@copilotkit/channels";
import type { Channel } from "@copilotkit/channels";
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

describe("ChannelConfigError", () => {
  it("sets .name to ChannelConfigError rather than the default Error", () => {
    expect(new ChannelConfigError("x").name).toBe("ChannelConfigError");
  });
});

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

  it("throws ChannelConfigError for a non-positive project id (cpk-0_...)", () => {
    // `cpk-0_...` matches the pattern but would fail deep in the launcher's
    // positive-projectId scope check — the parser validates its own output.
    expect(() => parseProjectIdFromApiKey("cpk-0_x_y")).toThrow(
      ChannelConfigError,
    );
  });

  it("returns the parsed id for a valid positive project id", () => {
    expect(parseProjectIdFromApiKey("cpk-42_x_y")).toBe(42);
  });

  it("throws ChannelConfigError for a project id that overflows safe-integer precision", () => {
    // A 20+-digit run still matches `\d+` but loses precision (or overflows
    // toward Infinity) once coerced with `Number` — `projectId > 0` alone would
    // pass this through, so the parser must also reject unsafe integers.
    const huge = "1".repeat(25);
    expect(() => parseProjectIdFromApiKey(`cpk-${huge}_x_y`)).toThrow(
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

  it("declares the per-Channel provider as the config adapter (provider: 'teams' → 'teams') (OSS-473)", () => {
    // The provider is a per-Channel choice, not a manager-wide default — a
    // Teams-backed managed Channel must be able to declare "teams" to the
    // gateway. Pre-change this always yielded "slack" (the provider was a
    // hard-coded global default), so this assertion is the regression guard.
    const intelligence = fakeIntelligence("cpk-7_a_b");
    const channel = createChannel({ name: "support", provider: "teams" });

    const config = deriveChannelActivationConfig({
      intelligence,
      channel,
      runtimeInstanceId: "rti_y",
    });

    expect(config.adapter).toBe("teams");
  });

  it("declares the per-Channel provider as the config adapter (provider: 'slack' → 'slack')", () => {
    const intelligence = fakeIntelligence("cpk-7_a_b");
    const channel = createChannel({ name: "support", provider: "slack" });

    expect(
      deriveChannelActivationConfig({
        intelligence,
        channel,
        runtimeInstanceId: "rti_y",
      }).adapter,
    ).toBe("slack");
  });

  it("defaults the config adapter to the documented 'slack' when provider is unset", () => {
    const intelligence = fakeIntelligence("cpk-7_a_b");
    const channel = createChannel({ name: "support" });

    expect(
      deriveChannelActivationConfig({
        intelligence,
        channel,
        runtimeInstanceId: "rti_y",
      }).adapter,
    ).toBe("slack");
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

  it('does NOT replicate the launcher\'s channel-name FORMAT rules — a name like "Slack" is forwarded, not rejected here (OSS-473)', () => {
    // Channel-name format (kebab-case/length) + reserved-name are validated at
    // activation by the channels-intelligence launcher (single source of truth)
    // and surface as a logged `error` status; this config no longer replicates
    // that rule, so a non-kebab name resolves without throwing.
    const intelligence = fakeIntelligence("cpk-42_short_long");
    const config = deriveChannelActivationConfig({
      intelligence,
      channel: createChannel({ name: "Slack" }),
      runtimeInstanceId: "rti_x",
    });

    expect(config.channelName).toBe("Slack");
  });

  it("trims a padded provider rather than forwarding it padded", () => {
    // `provider` is typed to the "slack" | "teams" union, but the deriver stays
    // defensive against a padded runtime value that bypasses the type; cast to
    // exercise that trim path.
    const intelligence = fakeIntelligence("cpk-7_a_b");
    const channel = {
      name: "support",
      provider: "  teams  ",
    } as unknown as Channel;

    expect(
      deriveChannelActivationConfig({
        intelligence,
        channel,
        runtimeInstanceId: "rti_x",
      }).adapter,
    ).toBe("teams");
  });

  it('defaults to "slack" for an empty or whitespace-only provider', () => {
    const intelligence = fakeIntelligence("cpk-7_a_b");
    const emptyProvider = {
      name: "support",
      provider: "",
    } as unknown as Channel;
    const blankProvider = {
      name: "support",
      provider: "   ",
    } as unknown as Channel;

    expect(
      deriveChannelActivationConfig({
        intelligence,
        channel: emptyProvider,
        runtimeInstanceId: "rti_x",
      }).adapter,
    ).toBe("slack");
    expect(
      deriveChannelActivationConfig({
        intelligence,
        channel: blankProvider,
        runtimeInstanceId: "rti_x",
      }).adapter,
    ).toBe("slack");
  });
});
