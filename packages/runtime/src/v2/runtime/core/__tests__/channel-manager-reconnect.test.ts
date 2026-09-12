import { describe, it, expect, vi } from "vitest";
import { createChannel } from "@copilotkit/channels";
import { CopilotKitIntelligence } from "../../intelligence-platform";
import { ChannelManager } from "../channel-manager";
import type { ActivateChannelEngine, ChannelsHandle } from "../channel-manager";
import { telemetry } from "../../telemetry";
import type { TelemetryCapture } from "../../telemetry/telemetry-client";

/* ------------------------------------------------------------------------------------------------
 * Reconnection is delegated to the Phoenix connection layer (the launcher's
 * socket auto-reconnects and auto-rejoins). The manager therefore must NOT
 * re-activate a Channel on a drop — but it MUST reflect real connection health
 * through the session's `onStateChange` observer so `status()` is honest rather
 * than reporting `online` forever after a drop. These tests pin that contract:
 * a drop → `reconnecting`, a rejoin → `online`, and a bounded give-up →
 * `error`, with NO further engine call and the manager
 * left coherent and usable.
 * --------------------------------------------------------------------------------------------- */

type ConnectionState = "online" | "reconnecting" | "gave_up";

/** The cause the session attaches to a non-`online` transition (OSS-670). */
type ConnectionDetail = { reason?: string; code?: string };

/** A CopilotKitIntelligence whose runner API key carries a parseable project id. */
function fakeIntelligence(): CopilotKitIntelligence {
  return new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey: "cpk-42_short_long",
  });
}

/** A fake ChannelsHandle whose connection-state observer can be driven on demand. */
function observableHandle(): ChannelsHandle & {
  stop: ReturnType<typeof vi.fn>;
  fireState: (state: ConnectionState, detail?: ConnectionDetail) => void;
} {
  let cb:
    | ((state: ConnectionState, detail?: ConnectionDetail) => void)
    | undefined;
  return {
    metadata: {},
    stop: vi.fn(async () => {}),
    onStateChange(
      fn: (state: ConnectionState, detail?: ConnectionDetail) => void,
    ) {
      cb = fn;
    },
    fireState(state: ConnectionState, detail?: ConnectionDetail) {
      cb?.(state, detail);
    },
  };
}

describe("ChannelManager connection health (onStateChange)", () => {
  it("a drop moves the channel to reconnecting and a rejoin restores online, with no re-activation", async () => {
    const handle = observableHandle();
    const engine: ActivateChannelEngine = vi.fn(async () => handle);

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ identifyUser: "platform", name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();
    await mgr.ready();

    expect(engine).toHaveBeenCalledTimes(1);
    expect(mgr.status().channels.support).toBe("online");

    handle.fireState("reconnecting");
    expect(mgr.status().channels.support).toBe("reconnecting");
    expect(mgr.status().overall).toBe("reconnecting");

    handle.fireState("online");
    expect(mgr.status().channels.support).toBe("online");
    expect(mgr.status().overall).toBe("online");

    // The manager never re-invokes the engine on a drop — Phoenix owns rejoin.
    expect(engine).toHaveBeenCalledTimes(1);
  });

  it("a bounded give-up moves the channel to error", async () => {
    const handle = observableHandle();
    const engine: ActivateChannelEngine = vi.fn(async () => handle);

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ identifyUser: "platform", name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();
    await mgr.ready();

    handle.fireState("reconnecting");
    handle.fireState("gave_up");

    expect(mgr.status().channels.support).toBe("error");
    expect(mgr.status().overall).toBe("error");
    expect(engine).toHaveBeenCalledTimes(1);
  });

  it("does not throw when a state transition fires, and leaves the manager coherent", async () => {
    const handle = observableHandle();
    const engine: ActivateChannelEngine = vi.fn(async () => handle);

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ identifyUser: "platform", name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();
    await mgr.ready();

    expect(() => handle.fireState("reconnecting")).not.toThrow();
    await expect(mgr.ready()).resolves.toBeUndefined();
  });

  it("the manager stays usable after a drop: stop() still tears the channel down", async () => {
    const handle = observableHandle();
    const engine: ActivateChannelEngine = vi.fn(async () => handle);

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ identifyUser: "platform", name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();
    await mgr.ready();

    handle.fireState("reconnecting");

    await expect(mgr.stop()).resolves.toBeUndefined();
    expect(handle.stop).toHaveBeenCalledTimes(1);
    expect(mgr.status().channels.support).toBe("stopped");
    expect(mgr.status().overall).toBe("stopped");
  });

  it("a stopped manager ignores late connection events (no resurrection out of stopped)", async () => {
    const handle = observableHandle();
    const engine: ActivateChannelEngine = vi.fn(async () => handle);

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ identifyUser: "platform", name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();
    await mgr.ready();
    await mgr.stop();

    handle.fireState("reconnecting");
    handle.fireState("online");

    expect(mgr.status().channels.support).toBe("stopped");
    expect(mgr.status().overall).toBe("stopped");
  });

  it("logs the drop cause and keeps logging while the session is down (OSS-670)", async () => {
    const handle = observableHandle();
    const engine: ActivateChannelEngine = vi.fn(async () => handle);
    const logs: string[] = [];

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ identifyUser: "platform", name: "support" })],
      activateChannel: engine,
      log: (m: string) => logs.push(m),
      reconnectLogIntervalMs: 5,
    });
    mgr.activate();
    await mgr.ready();

    handle.fireState("reconnecting", {
      reason: "read ECONNRESET",
      code: "ECONNRESET",
    });
    expect(logs.some((m) => m.includes("ECONNRESET"))).toBe(true);

    // Still down: the operator must keep hearing about it.
    await new Promise((r) => setTimeout(r, 20));
    expect(logs.filter((m) => m.includes("still down")).length).toBeGreaterThan(
      0,
    );

    const before = logs.length;
    handle.fireState("online");
    await new Promise((r) => setTimeout(r, 20));
    // Recovery stops the repeat: only the "back online" line lands after it.
    expect(
      logs.slice(before).filter((m) => m.includes("still down")),
    ).toHaveLength(0);
    await mgr.stop();
  });

  it("says retries continue when the give-up window elapses (OSS-670)", async () => {
    const handle = observableHandle();
    const engine: ActivateChannelEngine = vi.fn(async () => handle);
    const logs: string[] = [];

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ identifyUser: "platform", name: "support" })],
      activateChannel: engine,
      log: (m: string) => logs.push(m),
    });
    mgr.activate();
    await mgr.ready();

    handle.fireState("reconnecting", { reason: "handshake refused" });
    handle.fireState("gave_up", { reason: "handshake refused" });

    const line = logs.find((m) => m.includes("gave up reconnecting"))!;
    expect(line).toContain("handshake refused");
    expect(line).toMatch(/still retrying/i);
    // Status semantics are unchanged.
    expect(mgr.status().channels.support).toBe("error");
    await mgr.stop();
  });

  it("repeats the drop cause on every still-down line (OSS-825)", async () => {
    const handle = observableHandle();
    const engine: ActivateChannelEngine = vi.fn(async () => handle);
    const logs: string[] = [];

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ identifyUser: "platform", name: "support" })],
      activateChannel: engine,
      log: (m: string) => logs.push(m),
      reconnectLogIntervalMs: 5,
    });
    mgr.activate();
    await mgr.ready();

    handle.fireState("reconnecting", {
      reason: "the gateway host answered HTTP 502",
    });
    await new Promise((r) => setTimeout(r, 20));

    // An operator reading a repeat line hours into an outage must not have to
    // scroll back to the first line to learn the cause: prod emitted
    // "still down after 233134s; Phoenix is retrying" with no cause at all.
    const repeats = logs.filter((m) => m.includes("still down"));
    expect(repeats.length).toBeGreaterThan(0);
    expect(repeats[0]).toContain("HTTP 502");
    await mgr.stop();
  });
});

/* ------------------------------------------------------------------------------------------------
 * Drop/recovery telemetry (OSS-825). A managed session that loses its gateway
 * link is invisible outside the host process: the only trace is the injected
 * `log` seam, which for a self-hosted or Railway-hosted runtime reaches nobody
 * who can act on it. A 2026-08-12 incident ran 2.7 days on one Channel before a
 * customer reported it. These events make an outage — and its end — reportable.
 * --------------------------------------------------------------------------------------------- */
describe("ChannelManager drop/recovery telemetry (OSS-825)", () => {
  it("uses an injected telemetry capture instead of the process singleton", async () => {
    const defaultCaptureSpy = vi
      .spyOn(telemetry, "capture")
      .mockResolvedValue(undefined);
    const scopedCapture = vi.fn().mockResolvedValue(undefined);
    const scopedTelemetry = { capture: scopedCapture } as TelemetryCapture;
    try {
      const handle = observableHandle();
      const engine: ActivateChannelEngine = vi.fn(async () => handle);
      const args = {
        intelligence: fakeIntelligence(),
        channels: [
          createChannel({ identifyUser: "platform", name: "support" }),
        ],
        activateChannel: engine,
        telemetry: scopedTelemetry,
      };
      const mgr = new ChannelManager(args);
      mgr.activate();
      await mgr.ready();

      handle.fireState("reconnecting", { reason: "socket dropped" });

      expect(scopedCapture).toHaveBeenCalledWith(
        "oss.runtime.channel_session_dropped",
        { reason: "socket dropped" },
      );
      expect(defaultCaptureSpy).not.toHaveBeenCalled();
      await mgr.stop();
    } finally {
      defaultCaptureSpy.mockRestore();
    }
  });

  it("captures a dropped event carrying the transport cause", async () => {
    const captureSpy = vi
      .spyOn(telemetry, "capture")
      .mockResolvedValue(undefined);
    try {
      const handle = observableHandle();
      const engine: ActivateChannelEngine = vi.fn(async () => handle);
      const mgr = new ChannelManager({
        intelligence: fakeIntelligence(),
        channels: [
          createChannel({ identifyUser: "platform", name: "support" }),
        ],
        activateChannel: engine,
      });
      mgr.activate();
      await mgr.ready();

      handle.fireState("reconnecting", {
        reason: "the gateway host answered HTTP 502",
      });

      expect(captureSpy).toHaveBeenCalledWith(
        "oss.runtime.channel_session_dropped",
        { reason: "the gateway host answered HTTP 502" },
      );
      await mgr.stop();
    } finally {
      captureSpy.mockRestore();
    }
  });

  it("captures a recovered event carrying the outage duration", async () => {
    const captureSpy = vi
      .spyOn(telemetry, "capture")
      .mockResolvedValue(undefined);
    try {
      const handle = observableHandle();
      const engine: ActivateChannelEngine = vi.fn(async () => handle);
      const mgr = new ChannelManager({
        intelligence: fakeIntelligence(),
        channels: [
          createChannel({ identifyUser: "platform", name: "support" }),
        ],
        activateChannel: engine,
      });
      mgr.activate();
      await mgr.ready();

      handle.fireState("reconnecting");
      await new Promise((r) => setTimeout(r, 10));
      handle.fireState("online");

      const call = captureSpy.mock.calls.find(
        ([event]) => event === "oss.runtime.channel_session_recovered",
      );
      expect(call).toBeDefined();
      expect((call![1] as { downForMs: number }).downForMs).toBeGreaterThan(0);
      await mgr.stop();
    } finally {
      captureSpy.mockRestore();
    }
  });

  it("captures no recovery for an online transition that follows no outage", async () => {
    const captureSpy = vi
      .spyOn(telemetry, "capture")
      .mockResolvedValue(undefined);
    try {
      const handle = observableHandle();
      const engine: ActivateChannelEngine = vi.fn(async () => handle);
      const mgr = new ChannelManager({
        intelligence: fakeIntelligence(),
        channels: [
          createChannel({ identifyUser: "platform", name: "support" }),
        ],
        activateChannel: engine,
      });
      mgr.activate();
      await mgr.ready();

      // A session may report `online` without a preceding drop; that is not a
      // recovery and must not be reported as one.
      handle.fireState("online");

      expect(captureSpy).not.toHaveBeenCalledWith(
        "oss.runtime.channel_session_recovered",
        expect.anything(),
      );
      await mgr.stop();
    } finally {
      captureSpy.mockRestore();
    }
  });
});
