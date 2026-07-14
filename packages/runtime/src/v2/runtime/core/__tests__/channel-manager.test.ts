import { describe, it, expect, vi } from "vitest";
import { createChannel } from "@copilotkit/channels";
import { CopilotKitIntelligence } from "../../intelligence-platform";
import {
  ChannelManager,
  ChannelSetupRequiredError,
  isModuleNotFound,
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

/** A minimal fake ChannelsHandle whose `stop` is a spy. */
function fakeHandle(): ChannelsHandle & { stop: ReturnType<typeof vi.fn> } {
  return { metadata: {}, stop: vi.fn(async () => {}) };
}

describe("ChannelManager", () => {
  it("activate() starts one engine call per channel with distinct runtimeInstanceIds and reaches online after ready()", async () => {
    const chA = createChannel({ name: "support" });
    const chB = createChannel({ name: "sales" });
    const seenIds: string[] = [];
    const engine: ActivateChannelEngine = vi.fn(async (config) => {
      seenIds.push(config.runtimeInstanceId);
      return fakeHandle();
    });

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [chA, chB],
      activateChannel: engine,
    });
    mgr.activate();

    expect(engine).toHaveBeenCalledTimes(2);
    expect(mgr.status().overall).toBe("connecting");
    expect(new Set(seenIds).size).toBe(2);
    expect(seenIds.every((id) => id.startsWith("rti_"))).toBe(true);

    await mgr.ready();

    expect(mgr.status().overall).toBe("online");
    expect(mgr.status().channels).toEqual({
      support: "online",
      sales: "online",
    });
  });

  it("a second activate() is a no-op (idempotent)", async () => {
    const engine: ActivateChannelEngine = vi.fn(async () => fakeHandle());
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
    });

    mgr.activate();
    mgr.activate();

    expect(engine).toHaveBeenCalledTimes(1);
    await mgr.ready();
  });

  it("does not call the engine at construction; stop() stops each handle once and is idempotent", async () => {
    const handleA = fakeHandle();
    const handleB = fakeHandle();
    const handles = [handleA, handleB];
    let i = 0;
    const engine: ActivateChannelEngine = vi.fn(async () => handles[i++]!);

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [
        createChannel({ name: "support" }),
        createChannel({ name: "sales" }),
      ],
      activateChannel: engine,
    });

    expect(engine).toHaveBeenCalledTimes(0);

    mgr.activate();
    await mgr.ready();
    await mgr.stop();
    await mgr.stop();

    expect(handleA.stop).toHaveBeenCalledTimes(1);
    expect(handleB.stop).toHaveBeenCalledTimes(1);
    expect(mgr.status().overall).toBe("stopped");
    expect(mgr.status().channels).toEqual({
      support: "stopped",
      sales: "stopped",
    });
  });

  it("marks a ChannelSetupRequiredError rejection as setup_required without failing ready(); other channel stays online", async () => {
    const engine: ActivateChannelEngine = async (config) => {
      if (config.channelName === "sales") {
        throw new ChannelSetupRequiredError(
          "no managed provider for sales yet",
        );
      }
      return fakeHandle();
    };

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [
        createChannel({ name: "support" }),
        createChannel({ name: "sales" }),
      ],
      activateChannel: engine,
    });
    mgr.activate();

    await expect(mgr.ready()).resolves.toBeUndefined();
    expect(mgr.status().channels).toEqual({
      support: "online",
      sales: "setup_required",
    });
    expect(mgr.status().overall).toBe("setup_required");
  });

  it("treats an error carrying code SETUP_REQUIRED as setup_required", async () => {
    const engine: ActivateChannelEngine = async () => {
      const err = Object.assign(new Error("setup"), { code: "SETUP_REQUIRED" });
      throw err;
    };
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();

    await expect(mgr.ready()).resolves.toBeUndefined();
    expect(mgr.status().channels.support).toBe("setup_required");
  });

  it("marks a plain error rejection as error and rejects ready()", async () => {
    const engine: ActivateChannelEngine = async () => {
      throw new Error("boom");
    };
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();

    const err = await mgr.ready().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AggregateError);
    expect((err as AggregateError).errors[0]).toMatchObject({
      message: "boom",
    });
    expect(mgr.status().channels.support).toBe("error");
    expect(mgr.status().overall).toBe("error");
  });

  it("ready() rejects when a channel does not settle within timeoutMs", async () => {
    const engine: ActivateChannelEngine = () =>
      new Promise<ChannelsHandle>(() => {});
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();

    await expect(mgr.ready({ timeoutMs: 25 })).rejects.toThrow();
    expect(mgr.status().overall).toBe("connecting");
  });

  it("activate() throws on duplicate channel names before any engine call (no leak)", () => {
    const engine: ActivateChannelEngine = vi.fn(async () => fakeHandle());
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [
        createChannel({ name: "support" }),
        createChannel({ name: "support" }),
      ],
      activateChannel: engine,
    });

    expect(() => mgr.activate()).toThrow(/support/);
    expect(engine).not.toHaveBeenCalled();
  });

  it("stop() resolves promptly when an activation never settles, and tears down a handle that settles after stop()", async () => {
    const handle = fakeHandle();
    let resolveActivation!: (h: ChannelsHandle) => void;
    const engine: ActivateChannelEngine = vi.fn(
      () =>
        new Promise<ChannelsHandle>((resolve) => {
          resolveActivation = resolve;
        }),
    );
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();

    await expect(
      Promise.race([
        mgr.stop(),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error("stop() hung")), 1000),
        ),
      ]),
    ).resolves.toBeUndefined();
    expect(mgr.status().channels.support).toBe("stopped");

    resolveActivation(handle);
    await vi.waitFor(() => expect(handle.stop).toHaveBeenCalledTimes(1));
    expect(mgr.status().channels.support).toBe("stopped");
  });

  it("stop() completes and marks every channel stopped even when a handle.stop() rejects", async () => {
    const throwingHandle: ChannelsHandle & { stop: ReturnType<typeof vi.fn> } =
      {
        metadata: {},
        stop: vi.fn(async () => {
          throw new Error("session.disconnect failed");
        }),
      };
    const okHandle = fakeHandle();
    const handles = [throwingHandle, okHandle];
    let i = 0;
    const engine: ActivateChannelEngine = vi.fn(async () => handles[i++]!);

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [
        createChannel({ name: "support" }),
        createChannel({ name: "sales" }),
      ],
      activateChannel: engine,
    });
    mgr.activate();
    await mgr.ready();

    await expect(mgr.stop()).resolves.toBeUndefined();

    expect(throwingHandle.stop).toHaveBeenCalledTimes(1);
    expect(okHandle.stop).toHaveBeenCalledTimes(1);
    expect(mgr.status().channels).toEqual({
      support: "stopped",
      sales: "stopped",
    });
    expect(mgr.status().overall).toBe("stopped");
  });

  it("stop() does not throw when a channel never produced a handle (setup_required)", async () => {
    const engine: ActivateChannelEngine = async () => {
      throw new ChannelSetupRequiredError("no provider");
    };
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();
    await mgr.ready();

    await expect(mgr.stop()).resolves.toBeUndefined();
    expect(mgr.status().channels.support).toBe("stopped");
  });
});

describe("isModuleNotFound", () => {
  it("recognizes ERR_MODULE_NOT_FOUND and MODULE_NOT_FOUND error codes", () => {
    expect(isModuleNotFound({ code: "ERR_MODULE_NOT_FOUND" })).toBe(true);
    expect(isModuleNotFound({ code: "MODULE_NOT_FOUND" })).toBe(true);
  });

  it("returns false for unrelated errors and non-error values", () => {
    expect(isModuleNotFound(new Error("boom"))).toBe(false);
    expect(isModuleNotFound({ code: "SETUP_REQUIRED" })).toBe(false);
    expect(isModuleNotFound(null)).toBe(false);
    expect(isModuleNotFound("boom")).toBe(false);
  });
});
