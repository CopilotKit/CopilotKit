import { describe, it, expect, vi } from "vitest";
import { createChannel } from "@copilotkit/channels";
import { CopilotKitIntelligence } from "../../intelligence-platform";
import { ChannelManager } from "../channel-manager";
import type { ActivateChannelEngine, ChannelsHandle } from "../channel-manager";

/* ------------------------------------------------------------------------------------------------
 * Reconnection is delegated to the Phoenix connection layer (the launcher's
 * socket auto-reconnects and auto-rejoins). The manager therefore must NOT
 * re-activate a Channel on a socket drop — it only registers a log-only
 * `onClose` breadcrumb. These tests pin that contract: a drop makes no further
 * engine call, does not throw, and leaves the manager coherent and usable.
 * --------------------------------------------------------------------------------------------- */

/** A CopilotKitIntelligence whose runner API key carries a parseable project id. */
function fakeIntelligence(): CopilotKitIntelligence {
  return new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey: "cpk-42_short_long",
  });
}

/** A fake ChannelsHandle whose `onClose` callback can be fired on demand by the test. */
function closableHandle(): ChannelsHandle & {
  stop: ReturnType<typeof vi.fn>;
  fireClose: () => void;
} {
  let cb: (() => void) | undefined;
  return {
    metadata: {},
    stop: vi.fn(async () => {}),
    onClose(fn: () => void) {
      cb = fn;
    },
    fireClose() {
      cb?.();
    },
  };
}

describe("ChannelManager socket drop (delegated to Phoenix)", () => {
  it("a dropped socket does not re-activate the channel and does not throw", async () => {
    const handle = closableHandle();
    const engine: ActivateChannelEngine = vi.fn(async () => handle);

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();
    await mgr.ready();

    expect(engine).toHaveBeenCalledTimes(1);
    expect(mgr.status().channels.support).toBe("online");

    expect(() => handle.fireClose()).not.toThrow();

    expect(engine).toHaveBeenCalledTimes(1);
    expect(mgr.status().channels.support).toBe("online");
    expect(mgr.status().overall).toBe("online");
  });

  it("the manager stays usable after a drop: stop() still tears the channel down", async () => {
    const handle = closableHandle();
    const engine: ActivateChannelEngine = vi.fn(async () => handle);

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();
    await mgr.ready();

    handle.fireClose();

    await expect(mgr.stop()).resolves.toBeUndefined();
    expect(handle.stop).toHaveBeenCalledTimes(1);
    expect(mgr.status().channels.support).toBe("stopped");
    expect(mgr.status().overall).toBe("stopped");
  });
});
