import { describe, it, expect, vi } from "vitest";
import { createChannel, FakeAdapter } from "@copilotkit/channels";
import { startChannelsOverRealtimeGateway } from "@copilotkit/channels-intelligence";
import { CopilotKitIntelligence } from "../../intelligence-platform";
import {
  ChannelManager,
  ChannelSetupRequiredError,
  isModuleNotFound,
  defaultActivateChannel,
} from "../channel-manager";
import type {
  ActivateChannelEngine,
  ChannelsHandle,
  ChannelsIntelligenceModule,
} from "../channel-manager";
import type { ChannelActivationConfig } from "../channel-activation-config";

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

describe("ChannelSetupRequiredError", () => {
  it("sets .name to ChannelSetupRequiredError rather than the default Error", () => {
    expect(new ChannelSetupRequiredError("x").name).toBe(
      "ChannelSetupRequiredError",
    );
  });
});

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

  it("ready() surfaces the erroring channel's real reason even when a sibling hangs", async () => {
    const boom = new Error("activation exploded");
    const engine: ActivateChannelEngine = (_config, channel) =>
      channel.name === "support"
        ? Promise.reject(boom) // errors immediately
        : new Promise<ChannelsHandle>(() => {}); // sibling hangs forever
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [
        createChannel({ name: "support" }),
        createChannel({ name: "sales" }),
      ],
      activateChannel: engine,
    });
    mgr.activate();

    const err = await mgr.ready({ timeoutMs: 25 }).then(
      () => undefined,
      (e: unknown) => e,
    );
    // A set-wide timeout would have rejected with only a generic timeout and
    // DISCARDED `boom`. The per-channel timeout aggregate carries BOTH.
    expect(err).toBeInstanceOf(AggregateError);
    const agg = err as AggregateError;
    expect(agg.errors).toContain(boom);
    expect(
      agg.errors.some(
        (e) => e instanceof Error && /"sales" did not settle/.test(e.message),
      ),
    ).toBe(true);
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

    let hangTimer: ReturnType<typeof setTimeout>;
    await expect(
      Promise.race([
        mgr.stop(),
        new Promise((_resolve, reject) => {
          hangTimer = setTimeout(() => reject(new Error("stop() hung")), 1000);
        }),
      ]),
    ).resolves.toBeUndefined();
    clearTimeout(hangTimer!);
    expect(mgr.status().channels.support).toBe("stopped");

    resolveActivation(handle);
    await vi.waitFor(() => expect(handle.stop).toHaveBeenCalledTimes(1));
    expect(mgr.status().channels.support).toBe("stopped");
  });

  it("stop() bounds a wedged handle.stop() so teardown can't hang (per-handle timeout)", async () => {
    const logs: unknown[][] = [];
    // A handle whose stop() never settles — the SIGTERM-hang risk.
    const wedged: ChannelsHandle & { stop: ReturnType<typeof vi.fn> } = {
      metadata: {},
      stop: vi.fn(() => new Promise<void>(() => {})),
    };
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: async () => wedged,
      stopHandleTimeoutMs: 20,
      log: (...args) => logs.push(args),
    });
    await mgr.ready();

    let hangTimer: ReturnType<typeof setTimeout>;
    await expect(
      Promise.race([
        mgr.stop(),
        new Promise((_resolve, reject) => {
          hangTimer = setTimeout(() => reject(new Error("stop() hung")), 1000);
        }),
      ]),
    ).resolves.toBeUndefined();
    clearTimeout(hangTimer!);

    expect(mgr.status().channels.support).toBe("stopped");
    expect(wedged.stop).toHaveBeenCalledTimes(1);
    const timeoutLog = logs.find(
      ([msg]) =>
        typeof msg === "string" &&
        msg.includes("channel handle stop() failed during teardown"),
    );
    expect(timeoutLog).toBeDefined();
    expect((timeoutLog![1] as Error).message).toMatch(/timed out after 20ms/);
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

  it("keeps a channel stopped when its activation rejects AFTER stop() (RC5)", async () => {
    let rejectActivation!: (err: unknown) => void;
    const engine: ActivateChannelEngine = vi.fn(
      () =>
        new Promise<ChannelsHandle>((_resolve, reject) => {
          rejectActivation = reject;
        }),
    );
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();

    await mgr.stop();

    rejectActivation(new Error("connect failed after stop"));
    await vi.waitFor(() =>
      expect(mgr.status().channels.support).toBe("stopped"),
    );

    expect(mgr.status().overall).toBe("stopped");
    await expect(mgr.ready()).resolves.toBeUndefined();
  });

  it("stops a handle assigned in the same tick as stop() EXACTLY once (RC7)", async () => {
    // NOTE on reachability: a genuinely CONTENDED double-stop — where both
    // stop()'s own per-entry pass AND the success settle handler's conditional
    // `stopEntry` call each observe a live, not-yet-stopped handle — is not
    // reachable through the public API given the current code structure.
    // `this.stopped` is flipped synchronously at the very top of `stop()`,
    // strictly before stop()'s own (single, synchronous) pass over `entries`;
    // and the settle handler only ever routes through `stopEntry` when it
    // observes `this.stopped === true`, which can only be true because
    // stop()'s own pass over THIS entry has already run (and, since the handle
    // had not been assigned yet, was a no-op). So at most one of the two call
    // sites ever finds a live handle — the other is either a no-op (handle not
    // yet assigned) or never taken (this.stopped was still false when the
    // settle handler checked it). Verified directly: with the
    // `!entry.handleStopped` guard removed entirely, the resolveActivation()
    // -then-stop() sequence below still calls `handle.stop()` exactly once.
    //
    // So this test instead exercises `stopEntry`'s own idempotency contract
    // directly — the thing the guard actually exists to enforce — by invoking
    // it twice back-to-back on the same live entry via a narrow white-box seam.
    const handle = fakeHandle();
    const engine: ActivateChannelEngine = vi.fn(async () => handle);
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();
    await mgr.ready();

    interface ChannelManagerStopEntryInternals {
      entries: Map<
        string,
        { handle?: ChannelsHandle; handleStopped: boolean; status: string }
      >;
      stopEntry(entry: {
        handle?: ChannelsHandle;
        handleStopped: boolean;
        status: string;
      }): Promise<void>;
    }
    const internals = mgr as unknown as ChannelManagerStopEntryInternals;
    const entry = internals.entries.get("support")!;

    // Two invocations racing on the SAME entry: the first synchronously claims
    // the guard (sets `handleStopped = true`) before either reaches its own
    // `await`, so the second must observe the guard already tripped.
    await Promise.all([internals.stopEntry(entry), internals.stopEntry(entry)]);

    expect(handle.stop).toHaveBeenCalledTimes(1);
  });

  it("ready() resolves after stop() even when a channel settled to error before stop() (f3)", async () => {
    const engine: ActivateChannelEngine = async () => {
      throw new Error("connect boom");
    };
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();

    await mgr.ready().catch(() => {});
    expect(mgr.status().channels.support).toBe("error");

    await mgr.stop();

    await expect(mgr.ready()).resolves.toBeUndefined();
    expect(mgr.status().overall).toBe("stopped");
  });

  it("invokes the injected log sink with a failed-to-activate breadcrumb when a channel errors (RC11)", async () => {
    const log = vi.fn();
    const engine: ActivateChannelEngine = async () => {
      throw new Error("boom");
    };
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
      log,
    });
    mgr.activate();

    await mgr.ready().catch(() => {});

    const breadcrumbs = log.mock.calls.map(([msg]) => msg);
    expect(
      breadcrumbs.some(
        (msg) => typeof msg === "string" && msg.includes("failed to activate"),
      ),
    ).toBe(true);
  });

  it("logs (and does not rethrow) when a foreign handle.stop() throws SYNCHRONOUSLY during teardown (sync-throw guard)", async () => {
    const log = vi.fn();
    const syncThrowHandle: ChannelsHandle = {
      metadata: {},
      stop: () => {
        throw new Error("sync stop boom");
      },
    };
    const engine: ActivateChannelEngine = async () => syncThrowHandle;
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
      log,
    });
    mgr.activate();
    await mgr.ready();

    await expect(mgr.stop()).resolves.toBeUndefined();
    expect(mgr.status().channels.support).toBe("stopped");
    const breadcrumbs = log.mock.calls.map(([msg]) => msg);
    expect(
      breadcrumbs.some(
        (msg) =>
          typeof msg === "string" &&
          msg.includes("channel handle stop() failed during teardown"),
      ),
    ).toBe(true);
  });

  it("activate() after stop() opens no transports (stopped-guard)", async () => {
    const engine: ActivateChannelEngine = vi.fn(async () => fakeHandle());
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
    });

    await mgr.stop();
    mgr.activate();

    expect(engine).not.toHaveBeenCalled();
  });

  it("ready() on a fresh manager rejects with ChannelConfigError for duplicate names (lazy-activate path)", async () => {
    const engine: ActivateChannelEngine = vi.fn(async () => fakeHandle());
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [
        createChannel({ name: "support" }),
        createChannel({ name: "support" }),
      ],
      activateChannel: engine,
    });

    await expect(mgr.ready()).rejects.toThrow(/support/);
    expect(engine).not.toHaveBeenCalled();
  });

  it("an empty channels[] manager reports overall online and ready() resolves", async () => {
    const engine: ActivateChannelEngine = vi.fn(async () => fakeHandle());
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [],
      activateChannel: engine,
    });

    expect(mgr.status().overall).toBe("online");
    await expect(mgr.ready()).resolves.toBeUndefined();
    expect(engine).not.toHaveBeenCalled();
  });

  it("skips managed activation for a direct-adapter channel but records it unmanaged; the managed one reflects its real state", async () => {
    const log = vi.fn();
    const engine: ActivateChannelEngine = vi.fn(async () => fakeHandle());
    const managed = createChannel({ name: "support" });
    const direct = createChannel({
      name: "sales",
      adapters: [new FakeAdapter({ platform: "slack" })],
    });

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [managed, direct],
      activateChannel: engine,
      log,
    });
    mgr.activate();

    expect(engine).toHaveBeenCalledTimes(1);

    await expect(mgr.ready()).resolves.toBeUndefined();
    // The direct channel is surfaced as `unmanaged` (never omitted, never
    // `online`); the managed channel reflects its real activated state; and
    // `overall` folds over the managed channel only, so a healthy managed
    // channel beside an unmanaged one still reads `online`.
    expect(mgr.status().channels).toEqual({
      support: "online",
      sales: "unmanaged",
    });
    expect(mgr.status().overall).toBe("online");

    const breadcrumbs = log.mock.calls.map(([msg]) => msg);
    expect(
      breadcrumbs.some(
        (msg) =>
          typeof msg === "string" &&
          msg.includes("sales") &&
          msg.includes("direct adapter") &&
          msg.includes("unmanaged"),
      ),
    ).toBe(true);
  });

  it("reports a lone direct-adapter channel as unmanaged (not online), keeps it in status, and ready() still resolves", async () => {
    const engine: ActivateChannelEngine = vi.fn(async () => fakeHandle());
    const direct = createChannel({
      name: "sales",
      adapters: [new FakeAdapter({ platform: "slack" })],
    });

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [direct],
      activateChannel: engine,
    });
    mgr.activate();

    expect(engine).not.toHaveBeenCalled();
    // A runtime whose only channel is direct must NOT read healthy: overall is
    // `unmanaged`, and the channel is present in status (never an empty map).
    expect(mgr.status().overall).toBe("unmanaged");
    expect(mgr.status().channels).toEqual({ sales: "unmanaged" });
    // ready() may resolve (nothing on the managed path to wait for) but that
    // resolution implies no health — the truthfulness lives in status().
    await expect(mgr.ready()).resolves.toBeUndefined();
  });

  it("leaves an unmanaged channel unmanaged through stop() — the manager never owned its lifecycle", async () => {
    const engine: ActivateChannelEngine = vi.fn(async () => fakeHandle());
    const managed = createChannel({ name: "support" });
    const direct = createChannel({
      name: "sales",
      adapters: [new FakeAdapter({ platform: "slack" })],
    });

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [managed, direct],
      activateChannel: engine,
    });
    await mgr.ready();
    await mgr.stop();

    // The managed channel is torn down to `stopped`; the direct one stays
    // `unmanaged` (the manager cannot stop what it never started), so overall
    // folds to `stopped` over the managed channel.
    expect(mgr.status().channels).toEqual({
      support: "stopped",
      sales: "unmanaged",
    });
    expect(mgr.status().overall).toBe("stopped");
  });

  it("still enforces unique names across all declared channels, including direct ones", () => {
    const engine: ActivateChannelEngine = vi.fn(async () => fakeHandle());
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [
        createChannel({ name: "support" }),
        createChannel({
          name: "support",
          adapters: [new FakeAdapter({ platform: "slack" })],
        }),
      ],
      activateChannel: engine,
    });

    expect(() => mgr.activate()).toThrow(/support/);
    expect(engine).not.toHaveBeenCalled();
  });

  it("declares each Channel's own provider — two Channels with different providers are not collapsed to one global (OSS-473)", async () => {
    // The provider is per-Channel, not a manager-wide default: a Slack-backed
    // Channel and a Teams-backed Channel activated by the same manager must each
    // declare their own adapter to the gateway.
    const seen = new Map<string, string>();
    const engine: ActivateChannelEngine = vi.fn(async (config) => {
      seen.set(config.channelName, config.adapter);
      return fakeHandle();
    });
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [
        createChannel({ name: "support", provider: "slack" }),
        createChannel({ name: "sales", provider: "teams" }),
      ],
      activateChannel: engine,
    });
    mgr.activate();
    await mgr.ready();

    expect(seen.get("support")).toBe("slack");
    expect(seen.get("sales")).toBe("teams");
  });

  it("defaults a Channel with no provider to the documented 'slack' adapter", async () => {
    let seenAdapter: string | undefined;
    const engine: ActivateChannelEngine = vi.fn(async (config) => {
      seenAdapter = config.adapter;
      return fakeHandle();
    });
    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();
    await mgr.ready();

    expect(seenAdapter).toBe("slack");
  });
});

describe("defaultActivateChannel", () => {
  const config: ChannelActivationConfig = {
    wsUrl: "wss://runtime.example",
    apiKey: "cpk-42_short_long",
    projectId: 42,
    channelName: "support",
    adapter: "slack",
    runtimeInstanceId: "rti_x",
  };

  it("maps config to launcher opts and returns the launcher's handle", async () => {
    const handle: ChannelsHandle = { metadata: {}, stop: async () => {} };
    const start = vi.fn<
      ChannelsIntelligenceModule["startChannelsOverRealtimeGateway"]
    >(async () => handle);
    const channel = createChannel({ name: "support" });
    const importer = async (): Promise<ChannelsIntelligenceModule> => ({
      startChannelsOverRealtimeGateway: start,
    });

    const result = await defaultActivateChannel(config, channel, importer);

    expect(result).toBe(handle);
    expect(start).toHaveBeenCalledTimes(1);
    const [channels, opts] = start.mock.calls[0]!;
    expect(channels).toEqual([channel]);
    expect(opts).toEqual({
      wsUrl: "wss://runtime.example",
      apiKey: "cpk-42_short_long",
      scope: { projectId: 42, channelName: "support" },
      runtimeInstanceId: "rti_x",
      adapter: "slack",
    });
    // The scope carries ONLY projectId + channelName — never org/channelId.
    expect(opts.scope).not.toHaveProperty("organizationId");
    expect(opts.scope).not.toHaveProperty("channelId");
  });

  it("forwards the log sink to the launcher opts so transport-level drops surface", async () => {
    const handle: ChannelsHandle = { metadata: {}, stop: async () => {} };
    const start = vi.fn<
      ChannelsIntelligenceModule["startChannelsOverRealtimeGateway"]
    >(async () => handle);
    const channel = createChannel({ name: "support" });
    const importer = async (): Promise<ChannelsIntelligenceModule> => ({
      startChannelsOverRealtimeGateway: start,
    });
    const log = vi.fn();

    await defaultActivateChannel(config, channel, importer, log);

    const [, opts] = start.mock.calls[0]!;
    expect(opts.log).toBe(log);
  });

  it("throws a friendly install hint when the module is not found", async () => {
    const channel = createChannel({ name: "support" });
    const importer = async (): Promise<ChannelsIntelligenceModule> => {
      throw Object.assign(new Error("not found"), {
        code: "ERR_MODULE_NOT_FOUND",
      });
    };

    await expect(
      defaultActivateChannel(config, channel, importer),
    ).rejects.toThrow(
      /Managed Channels require '@copilotkit\/channels-intelligence'/,
    );
  });

  it("rethrows a generic import failure unchanged", async () => {
    const channel = createChannel({ name: "support" });
    const importer = async (): Promise<ChannelsIntelligenceModule> => {
      throw new Error("boom");
    };

    await expect(
      defaultActivateChannel(config, channel, importer),
    ).rejects.toThrow(/^boom$/);
  });
});

/**
 * A gateway-compatible fake WebSocket (phoenix v2 serializer) that rejects the
 * channel join with the gateway's setup-required reason
 * `channel_declaration_unavailable`. Records `close()` so teardown can be
 * asserted. This drives the REAL engine end-to-end: `defaultActivateChannel` →
 * real `startChannelsOverRealtimeGateway` → real `connectRealtimeGateway`.
 */
function makeSetupRequiredWebSocket() {
  const instances: FakeWebSocket[] = [];
  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = 0;
    onopen: ((ev?: unknown) => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: ((ev?: unknown) => void) | null = null;
    onclose: ((ev?: unknown) => void) | null = null;
    closed = false;
    constructor(public readonly url: string) {
      instances.push(this);
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.();
      });
    }
    send(data: string): void {
      let frame: unknown;
      try {
        frame = JSON.parse(data);
      } catch {
        return;
      }
      if (!Array.isArray(frame)) return;
      const [joinRef, ref, topic, event] = frame as [
        string,
        string,
        string,
        string,
      ];
      if (event !== "phx_join") return;
      const reply = JSON.stringify([
        joinRef,
        ref,
        topic,
        "phx_reply",
        {
          status: "error",
          response: { reason: "channel_declaration_unavailable" },
        },
      ]);
      queueMicrotask(() => this.onmessage?.({ data: reply }));
    }
    close(): void {
      this.closed = true;
      this.readyState = 3;
      this.onclose?.();
    }
  }
  return { FakeWebSocket, instances };
}

describe("ChannelManager — reachable setup_required over the REAL engine (OSS-473)", () => {
  it("degrades an unconfigured provider to setup_required (not error) and ready() resolves", async () => {
    const { FakeWebSocket } = makeSetupRequiredWebSocket();
    // Drive the REAL defaultActivateChannel → real startChannelsOverRealtimeGateway
    // → real connectRealtimeGateway; the only injected seam is the fake
    // WebSocket (an explicit launcher option), so the setup-required
    // translation is exercised on the production path, not a stubbed engine.
    const importer = async (): Promise<ChannelsIntelligenceModule> => ({
      startChannelsOverRealtimeGateway: (channels, opts) =>
        startChannelsOverRealtimeGateway(channels, {
          ...opts,
          webSocket: FakeWebSocket,
        }),
    });
    const engine: ActivateChannelEngine = (config, channel) =>
      defaultActivateChannel(config, channel, importer);

    const mgr = new ChannelManager({
      intelligence: fakeIntelligence(),
      channels: [createChannel({ name: "support" })],
      activateChannel: engine,
    });
    mgr.activate();

    await expect(mgr.ready()).resolves.toBeUndefined();
    expect(mgr.status().channels.support).toBe("setup_required");
    expect(mgr.status().overall).toBe("setup_required");
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
