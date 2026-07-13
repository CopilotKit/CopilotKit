import { describe, it, expect, vi } from "vitest";
import { createChannel } from "@copilotkit/channels";
import { CopilotKitIntelligence } from "../../intelligence-platform";
import {
  ChannelManager,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
} from "../channel-manager";
import type { ActivateChannelEngine, ChannelsHandle } from "../channel-manager";

/** A CopilotKitIntelligence whose runner API key carries a parseable project id. */
function fakeIntelligence(): CopilotKitIntelligence {
  return new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey: "cpk-42_short_long",
  });
}

/** A fake ChannelsHandle whose `onClose` callback can be fired on demand by the test. */
function reconnectableHandle(): ChannelsHandle & {
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

describe("ChannelManager reconnect", () => {
  it("reconnects after a dropped socket: reconnecting then back online with exactly one extra engine call", async () => {
    const handles = [reconnectableHandle(), reconnectableHandle()];
    let i = 0;
    const engine: ActivateChannelEngine = vi.fn(async () => handles[i++]!);
    let resolveSleep: (() => void) | undefined;
    const sleep = vi.fn(
      (_ms: number) =>
        new Promise<void>((resolve) => {
          resolveSleep = resolve;
        }),
    );

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
      sleep,
    });
    mgr.activate();
    await mgr.ready();

    expect(mgr.status().channels.support).toBe("online");
    expect(engine).toHaveBeenCalledTimes(1);

    handles[0]!.fireClose();

    expect(mgr.status().channels.support).toBe("reconnecting");
    expect(mgr.status().overall).toBe("reconnecting");
    expect(sleep).toHaveBeenCalledWith(RECONNECT_BASE_DELAY_MS);

    resolveSleep!();
    await vi.waitFor(() =>
      expect(mgr.status().channels.support).toBe("online"),
    );
    expect(engine).toHaveBeenCalledTimes(2);
  });

  it("re-registers onClose so a second drop keeps reconnecting", async () => {
    const handles = [
      reconnectableHandle(),
      reconnectableHandle(),
      reconnectableHandle(),
    ];
    let i = 0;
    const engine: ActivateChannelEngine = vi.fn(async () => handles[i++]!);
    const sleep = vi.fn(async (_ms: number) => {});

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
      sleep,
    });
    mgr.activate();
    await mgr.ready();

    handles[0]!.fireClose();
    await vi.waitFor(() =>
      expect(mgr.status().channels.support).toBe("online"),
    );
    expect(engine).toHaveBeenCalledTimes(2);

    handles[1]!.fireClose();
    await vi.waitFor(() =>
      expect(mgr.status().channels.support).toBe("online"),
    );
    expect(engine).toHaveBeenCalledTimes(3);
  });

  it("bounds reconnect backoff and gives up to error after the max attempt count", async () => {
    const handle = reconnectableHandle();
    let call = 0;
    const engine: ActivateChannelEngine = vi.fn(async () => {
      call++;
      if (call === 1) {
        return handle;
      }
      throw new Error("still down");
    });
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms);
    });

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
      sleep,
    });
    mgr.activate();
    await mgr.ready();

    handle.fireClose();

    await vi.waitFor(() => expect(mgr.status().channels.support).toBe("error"));

    expect(delays[0]).toBe(RECONNECT_BASE_DELAY_MS);
    expect(Math.max(...delays)).toBe(RECONNECT_MAX_DELAY_MS);
    expect(delays[delays.length - 1]).toBe(RECONNECT_MAX_DELAY_MS);
    expect(delays.length).toBe(RECONNECT_MAX_ATTEMPTS);
    // strictly non-decreasing (exponential until the cap)
    for (let k = 1; k < delays.length; k++) {
      expect(delays[k]!).toBeGreaterThanOrEqual(delays[k - 1]!);
    }
  });

  it("stop() mid-reconnect cancels a pending backoff, makes no further engine calls, and resolves promptly", async () => {
    const handle = reconnectableHandle();
    const engine: ActivateChannelEngine = vi.fn(async () => handle);
    // A sleep that never resolves on its own: only stop() can unblock the loop.
    const sleep = vi.fn((_ms: number) => new Promise<void>(() => {}));

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
      sleep,
    });
    mgr.activate();
    await mgr.ready();

    expect(engine).toHaveBeenCalledTimes(1);

    handle.fireClose();
    expect(mgr.status().channels.support).toBe("reconnecting");
    expect(sleep).toHaveBeenCalledTimes(1);

    await expect(mgr.stop()).resolves.toBeUndefined();

    // Give any (incorrectly) surviving reconnect loop a chance to re-activate.
    await new Promise((r) => setTimeout(r, 10));

    expect(engine).toHaveBeenCalledTimes(1);
    expect(handle.stop).toHaveBeenCalledTimes(1);
    expect(mgr.status().channels.support).toBe("stopped");
  });
});
