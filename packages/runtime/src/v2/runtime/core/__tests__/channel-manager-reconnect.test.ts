import { describe, it, expect, vi } from "vitest";
import { createChannel } from "@copilotkit/channels";
import { CopilotKitIntelligence } from "../../intelligence-platform";
import { ChannelManager } from "../channel-manager";
import type { ActivateChannelEngine, ChannelsHandle } from "../channel-manager";

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
});
