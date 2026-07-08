import { describe, it, expect, vi } from "vitest";
import { BotTelemetry, BOT_TELEMETRY_EVENTS } from "./bot-telemetry.js";
import { MemoryStore } from "../state/memory-store.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const base = {
  backend: new MemoryStore(),
  packageName: "@copilotkit/channels",
  packageVersion: "0.0.3",
};

describe("BotTelemetry", () => {
  it("sends event with anonymous_id + bot_session_id in global_properties", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const t = new BotTelemetry({
      ...base,
      disabled: false,
      send,
      sessionId: "S1",
      resolveId: async () => "ANON",
    });
    t.capture("oss.bot.configured", { platforms: ["slack"] });
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0]![0];
    expect(arg.event).toBe("oss.bot.configured");
    expect(arg.properties).toEqual({ platforms: ["slack"] });
    expect(arg.globalProperties.anonymous_id).toBe("ANON");
    expect(arg.globalProperties.bot_session_id).toBe("S1");
  });
  it("is a no-op when disabled", async () => {
    const send = vi.fn();
    const t = new BotTelemetry({ ...base, disabled: true, send });
    t.capture("oss.bot.started", {});
    await tick();
    expect(send).not.toHaveBeenCalled();
  });
  it("never throws when send rejects", async () => {
    const send = vi.fn().mockRejectedValue(new Error("boom"));
    const t = new BotTelemetry({
      ...base,
      disabled: false,
      send,
      resolveId: async () => "X",
    });
    expect(() => t.capture("oss.bot.agent_run", {})).not.toThrow();
    await tick();
  });
  it("exposes the five event names", () => {
    expect([...BOT_TELEMETRY_EVENTS].sort()).toEqual([
      "oss.bot.agent_run",
      "oss.bot.agent_run_failed",
      "oss.bot.configured",
      "oss.bot.start_failed",
      "oss.bot.started",
    ]);
  });
});
