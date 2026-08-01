/**
 * Managed-Channel lifecycle across the endpoint wrappers.
 *
 * `createCopilotRuntimeHandler` constructs the control surface but opens NO
 * socket at creation: activation stays LAZY there because the generic Fetch
 * handler is the serverless/edge entry point (see `handler-channels.test.ts`).
 *
 * The LONG-RUNNING wrappers are different — they can only run inside a process
 * that owns its own lifetime, so they AUTO-START activation at creation
 * (OSS-641) and `ready()` becomes await-and-observe rather than the trigger:
 *
 * - Node (`createCopilotNodeListener`) — auto-starts.
 * - Express (`createCopilotExpressHandler`) — auto-starts; an Express router
 *   requires a long-running `http.Server`.
 * - Hono (`createCopilotHonoHandler`) — stays LAZY: it is our Next.js App
 *   Router / edge surface (every `examples/showcases/*` route handler builds one
 *   at module scope), where per-isolate auto-start would mint competing
 *   listeners for the same Channel.
 *
 * `activateChannels: false` remains the opt-out for a long-running host that
 * does not want a socket (tests, short-lived scripts).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "@copilotkit/shared";
import { createCopilotNodeListener } from "../endpoints/node";
import { createCopilotExpressHandler } from "../endpoints/express";
import { createCopilotHonoHandler } from "../endpoints/hono";
import { CopilotRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform";
import { createChannel } from "@copilotkit/channels";
import type {
  ActivateChannelEngine,
  ChannelsHandle,
} from "../core/channel-manager";

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------------------------- */

const intelligence = () =>
  new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey: "cpk-42_short_long",
  });

const identifyUser = async () => ({ id: "u", name: "U" });

/**
 * A call-counting fake activation engine that resolves a no-op
 * {@link ChannelsHandle} without opening any transport.
 *
 * @returns The engine plus a `state.calls` counter of engine invocations.
 */
function countingEngine(): {
  engine: ActivateChannelEngine;
  state: { calls: number };
} {
  const state = { calls: 0 };
  const engine: ActivateChannelEngine = async () => {
    state.calls += 1;
    const handle: ChannelsHandle = { metadata: {}, stop: async () => {} };
    return handle;
  };
  return { engine, state };
}

/** An activation engine that always fails, standing in for an unreachable gateway. */
const failingEngine: ActivateChannelEngine = async () => {
  throw new Error("gateway unreachable");
};

const intelRuntimeWith1Channel = () =>
  new CopilotRuntime({
    agents: {},
    intelligence: intelligence(),
    identifyUser,
    channels: [createChannel({ name: "support" })],
  });

/**
 * Collect `unhandledRejection` reasons raised while `fn` runs, then wait long
 * enough for Node to have reported any (it fires the event a macrotask after a
 * rejected promise is left unhandled).
 *
 * @param fn - Work whose stray rejections should be captured.
 * @returns The reasons Node reported as unhandled during `fn` plus the drain.
 */
async function unhandledRejectionsDuring(fn: () => void): Promise<unknown[]> {
  const reasons: unknown[] = [];
  const onUnhandled = (reason: unknown) => reasons.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    fn();
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  return reasons;
}

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------------------------------------
 * Tests
 * --------------------------------------------------------------------------------------------- */

describe("endpoint wrappers — managed channels propagation", () => {
  it("Node listener starts activation at creation, without any ready() call", () => {
    const { engine, state } = countingEngine();

    const listener = createCopilotNodeListener({
      runtime: intelRuntimeWith1Channel(),
      __channelEngine: engine,
    });

    // Written without `!` on purpose: the branded overload makes `.channels`
    // non-optional for a runtime with declared Channels (OSS-646); the
    // compile-time proof lives in `handler-channels-types.test.ts`.
    expect(listener.channels).toBeDefined();
    expect(state.calls).toBe(1);
    expect(listener.channels.status().overall).toBe("connecting");
  });

  it("Node listener's ready() observes the auto-started activation instead of a second one", async () => {
    const { engine, state } = countingEngine();

    const listener = createCopilotNodeListener({
      runtime: intelRuntimeWith1Channel(),
      __channelEngine: engine,
    });

    await listener.channels.ready({ timeoutMs: 1000 });

    expect(state.calls).toBe(1);
    expect(listener.channels.status().overall).toBe("online");
    await listener.channels.stop();
  });

  it("Node listener has no .channels for a plain SSE runtime", () => {
    const { engine, state } = countingEngine();

    const listener = createCopilotNodeListener({
      runtime: new CopilotRuntime({ agents: {} }),
      __channelEngine: engine,
    });

    expect(listener.channels).toBeUndefined();
    expect(state.calls).toBe(0);
  });

  it("activateChannels: false opts a Node listener out of the auto-start", () => {
    const { engine, state } = countingEngine();

    const listener = createCopilotNodeListener({
      runtime: intelRuntimeWith1Channel(),
      activateChannels: false,
      __channelEngine: engine,
    });

    expect(listener.channels).toBeUndefined();
    expect(state.calls).toBe(0);
  });

  it("Node listener logs a failed auto-start instead of leaving an unhandled rejection", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    let listener!: ReturnType<typeof createCopilotNodeListener>;

    const unhandled = await unhandledRejectionsDuring(() => {
      listener = createCopilotNodeListener({
        runtime: intelRuntimeWith1Channel(),
        __channelEngine: failingEngine,
      });
    });

    expect(unhandled).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    // The reason survives to a later ready(), so a host that DOES await it still
    // sees the real failure rather than a silently-degraded listener.
    await expect(listener.channels!.ready({ timeoutMs: 1000 })).rejects.toThrow(
      /failed to activate/,
    );
  });

  it("Node listener logs a duplicate-Channel-name misconfiguration rather than throwing out of the factory", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const { engine, state } = countingEngine();
    const runtime = new CopilotRuntime({
      agents: {},
      intelligence: intelligence(),
      identifyUser,
      channels: [
        createChannel({ name: "support" }),
        createChannel({ name: "support" }),
      ],
    });

    const unhandled = await unhandledRejectionsDuring(() => {
      expect(() =>
        createCopilotNodeListener({ runtime, __channelEngine: engine }),
      ).not.toThrow();
    });

    expect(unhandled).toEqual([]);
    expect(state.calls).toBe(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toMatchObject({
      err: expect.objectContaining({
        message: expect.stringMatching(/Duplicate managed Channel name/),
      }),
    });
  });

  it("Express handler starts activation at creation and exposes .channels on the returned Router", async () => {
    const { engine, state } = countingEngine();

    const router = createCopilotExpressHandler({
      runtime: intelRuntimeWith1Channel(),
      basePath: "/api/copilotkit",
      __channelEngine: engine,
    });

    expect(router.channels).toBeDefined();
    expect(state.calls).toBe(1);
    await router.channels!.ready({ timeoutMs: 1000 });
    expect(state.calls).toBe(1);
    expect(router.channels!.status().overall).toBe("online");
    await router.channels!.stop();
  });

  it("two wrappers over the SAME runtime activate its Channels once, not twice", async () => {
    const { engine, state } = countingEngine();
    const runtime = intelRuntimeWith1Channel();

    // Auto-start makes the per-runtime manager cache load-bearing: before
    // OSS-641 a second wrapper could only double-activate if someone called
    // ready() twice, now merely constructing it would.
    const listener = createCopilotNodeListener({
      runtime,
      __channelEngine: engine,
    });
    const router = createCopilotExpressHandler({
      runtime,
      basePath: "/api/copilotkit",
      __channelEngine: engine,
    });

    expect(state.calls).toBe(1);
    expect(router.channels).toBe(listener.channels);
    await listener.channels.ready({ timeoutMs: 1000 });
    expect(state.calls).toBe(1);
    await listener.channels.stop();
  });

  it("Hono handler stays lazy so an edge/serverless isolate opens no socket at creation", async () => {
    const { engine, state } = countingEngine();

    const app = createCopilotHonoHandler({
      runtime: intelRuntimeWith1Channel(),
      basePath: "/api/copilotkit",
      __channelEngine: engine,
    });

    expect(state.calls).toBe(0);
    expect(app.channels).toBeDefined();
    await app.channels!.ready({ timeoutMs: 1000 });
    expect(state.calls).toBe(1);
    expect(app.channels!.status().overall).toBe("online");
    await app.channels!.stop();
  });
});
