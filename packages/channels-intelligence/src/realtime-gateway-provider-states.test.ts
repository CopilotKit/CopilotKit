import { describe, it, expect } from "vitest";
import { parseChannelProviderStates } from "./realtime-gateway.js";

describe("parseChannelProviderStates", () => {
  it("reads the channels map off a control join reply", () => {
    expect(
      parseChannelProviderStates({
        protocol: "channel_delivery_v1",
        runtimeInstanceId: "rti_x",
        channels: { support: "attached", sales: "not_attached" },
      }),
    ).toEqual({ support: "attached", sales: "not_attached" });
  });

  it("accepts every state the gateway can report", () => {
    expect(
      parseChannelProviderStates({
        channels: {
          a: "attached",
          b: "unhealthy",
          c: "not_attached",
          d: "disabled",
          e: "channel_not_declared",
        },
      }),
    ).toEqual({
      a: "attached",
      b: "unhealthy",
      c: "not_attached",
      d: "disabled",
      e: "channel_not_declared",
    });
  });

  describe("returns undefined — 'not reported', never 'no provider'", () => {
    // An older gateway and a gateway whose database read failed both omit the
    // key. Reading either as "unprovisioned" would turn a healthy fleet's status
    // into setup_required on a transient blip.
    it("when the key is absent (older gateway or failed lookup)", () => {
      expect(
        parseChannelProviderStates({
          protocol: "channel_delivery_v1",
          runtimeInstanceId: "rti_x",
        }),
      ).toBeUndefined();
    });

    it("when the reply is not an object", () => {
      for (const reply of [undefined, null, "channels", 7, true, []]) {
        expect(parseChannelProviderStates(reply)).toBeUndefined();
      }
    });

    it("when channels is not a plain object", () => {
      for (const channels of [null, "support", 7, ["support"]]) {
        expect(parseChannelProviderStates({ channels })).toBeUndefined();
      }
    });

    it("when channels is empty", () => {
      expect(parseChannelProviderStates({ channels: {} })).toBeUndefined();
    });

    it("when no entry carries a recognised state", () => {
      expect(
        parseChannelProviderStates({
          channels: { support: "brand_new_state", sales: 7 },
        }),
      ).toBeUndefined();
    });
  });

  it("drops only the unrecognised entries, keeping the ones that parsed", () => {
    // A future gateway adding a state must not blind a caller to the Channels it
    // still understands.
    expect(
      parseChannelProviderStates({
        channels: {
          support: "attached",
          sales: "brand_new_state",
          billing: 7,
          ops: null,
        },
      }),
    ).toEqual({ support: "attached" });
  });
});
