import { describe, it, expect, vi } from "vitest";
import {
  ChannelTelemetry,
  CHANNEL_TELEMETRY_EVENTS,
} from "./channel-telemetry.js";
import { MemoryStore } from "../state/memory-store.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const base = {
  backend: new MemoryStore(),
  packageName: "@copilotkit/channels",
  packageVersion: "0.0.3",
};

describe("ChannelTelemetry", () => {
  it("sends event with anonymous_id + channel_session_id in global_properties", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const t = new ChannelTelemetry({
      ...base,
      disabled: false,
      send,
      sessionId: "S1",
      resolveId: async () => "ANON",
    });
    t.capture("oss.channel.configured", { platforms: ["slack"] });
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0]![0];
    expect(arg.event).toBe("oss.channel.configured");
    expect(arg.properties).toEqual({ platforms: ["slack"] });
    expect(arg.globalProperties.anonymous_id).toBe("ANON");
    expect(arg.globalProperties.channel_session_id).toBe("S1");
  });
  it("is a no-op when disabled", async () => {
    const send = vi.fn();
    const t = new ChannelTelemetry({ ...base, disabled: true, send });
    t.capture("oss.channel.started", {});
    await tick();
    expect(send).not.toHaveBeenCalled();
  });
  it("never throws when send rejects", async () => {
    const send = vi.fn().mockRejectedValue(new Error("boom"));
    const t = new ChannelTelemetry({
      ...base,
      disabled: false,
      send,
      resolveId: async () => "X",
    });
    expect(() => t.capture("oss.channel.agent_run", {})).not.toThrow();
    await tick();
  });
  it("exposes the five event names", () => {
    expect([...CHANNEL_TELEMETRY_EVENTS].sort()).toEqual([
      "oss.channel.agent_run",
      "oss.channel.agent_run_failed",
      "oss.channel.configured",
      "oss.channel.start_failed",
      "oss.channel.started",
    ]);
  });
});
