import { describe, it, expect, vi } from "vitest";
import { logger } from "@copilotkit/shared";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
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

const identifyUser = vi.fn().mockResolvedValue({ id: "u", name: "U" });

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

const intelRuntimeWith1Channel = () =>
  new CopilotRuntime({
    agents: {},
    intelligence: intelligence(),
    identifyUser,
    channels: [createChannel({ name: "support" })],
  });

/* ------------------------------------------------------------------------------------------------
 * Tests
 * --------------------------------------------------------------------------------------------- */

describe("createCopilotRuntimeHandler — managed channels", () => {
  it("handler creation does not activate (engine never invoked until ready())", () => {
    const { engine, state } = countingEngine();

    const handler = createCopilotRuntimeHandler({
      runtime: intelRuntimeWith1Channel(),
      __channelEngine: engine,
    });

    // The generic Fetch handler must never open a socket on its own — creating
    // it on a serverless/edge host cannot own a persistent listener, so
    // activation is deferred to the first `ready()`. The engine is untouched at
    // creation, and the control surface reports a truthful "not started" status
    // (never a false `online`) before any `ready()`.
    expect(state.calls).toBe(0);
    expect(handler.channels).toBeDefined();
    expect(handler.channels.status().overall).not.toBe("online");
  });

  it("defers activation to the first ready() — not creation, not the first request", async () => {
    const { engine, state } = countingEngine();

    const handler = createCopilotRuntimeHandler({
      runtime: intelRuntimeWith1Channel(),
      __channelEngine: engine,
    });

    // No activation at creation...
    expect(state.calls).toBe(0);

    // ...nor on the first REQUEST (the request path must never trigger a
    // persistent listener).
    await handler(new Request("http://x/api/copilotkit/agents"));
    expect(state.calls).toBe(0);

    // Activation happens on the first ready() — never before.
    // No `!`: an Intelligence runtime with a declared channel yields the
    // non-optional-`.channels` handler overload (the documented shape).
    await handler.channels.ready({ timeoutMs: 1000 });
    expect(state.calls).toBe(1);
    expect(handler.channels.status().overall).toBe("online");

    // ready() is idempotent: a second call does not re-activate.
    await handler.channels.ready({ timeoutMs: 1000 });
    expect(state.calls).toBe(1);

    await handler.channels.stop();
  });

  it("is idempotent per runtime instance across repeated handler creation", async () => {
    const { engine, state } = countingEngine();
    const runtime = intelRuntimeWith1Channel();

    const first = createCopilotRuntimeHandler({
      runtime,
      __channelEngine: engine,
    });
    const second = createCopilotRuntimeHandler({
      runtime,
      __channelEngine: engine,
    });

    // Creation is lazy: no activation yet, and both handlers share ONE manager
    // (the WeakMap dedupes per runtime instance).
    expect(state.calls).toBe(0);
    expect(first.channels).toBeDefined();
    expect(first.channels).toBe(second.channels);

    // Activating through either handle activates the single shared manager
    // exactly once; a ready() through the other handle is a no-op.
    await first.channels.ready({ timeoutMs: 1000 });
    await second.channels.ready({ timeoutMs: 1000 });
    expect(state.calls).toBe(1);

    await first.channels.stop();
  });

  it("does not activate for a plain SSE runtime", () => {
    const { engine, state } = countingEngine();

    const handler = createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({ agents: {} }),
      __channelEngine: engine,
    });

    expect(handler.channels).toBeUndefined();
    expect(state.calls).toBe(0);
  });

  it("does not activate when activateChannels is false", () => {
    const { engine, state } = countingEngine();

    const handler = createCopilotRuntimeHandler({
      runtime: intelRuntimeWith1Channel(),
      activateChannels: false,
      __channelEngine: engine,
    });

    expect(handler.channels).toBeUndefined();
    expect(state.calls).toBe(0);
  });

  it("caches the un-activated manager; a duplicate-name misconfig surfaces on ready(), not at creation (RC9)", async () => {
    const { engine } = countingEngine();
    const runtime = new CopilotRuntime({
      agents: {},
      intelligence: intelligence(),
      identifyUser,
      channels: [
        createChannel({ name: "support" }),
        createChannel({ name: "support" }),
      ],
    });

    // Creation is lazy — it no longer activates, so the duplicate-name misconfig
    // does NOT throw at handler-creation time (serverless-safe: no socket, no
    // synchronous throw during module construction).
    const handler = createCopilotRuntimeHandler({
      runtime,
      __channelEngine: engine,
    });
    expect(handler.channels).toBeDefined();

    // Fail-loud is preserved: the misconfig surfaces on the first ready().
    await expect(handler.channels.ready()).rejects.toThrow(/support/);

    // A second handler for the SAME runtime reuses the cached (un-activated)
    // manager, and its ready() ALSO rejects — caching never swallows the
    // misconfig.
    const retry = createCopilotRuntimeHandler({
      runtime,
      __channelEngine: engine,
    });
    expect(retry.channels).toBe(handler.channels);
    await expect(retry.channels.ready()).rejects.toThrow(/support/);
  });

  it("wires the shared logger so a channel that fails to activate emits a breadcrumb (RC11)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const engine: ActivateChannelEngine = async () => {
        throw new Error("activation boom");
      };

      const handler = createCopilotRuntimeHandler({
        runtime: intelRuntimeWith1Channel(),
        __channelEngine: engine,
      });

      await handler.channels.ready().catch(() => {});

      const loggedMessages = warnSpy.mock.calls.map((args) => args[1]);
      expect(
        loggedMessages.some(
          (msg) =>
            typeof msg === "string" && msg.includes("failed to activate"),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("bridges the activation Error under the `err` key so pino preserves its message (RC15)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const engine: ActivateChannelEngine = async () => {
        throw new Error("activation boom");
      };

      const handler = createCopilotRuntimeHandler({
        runtime: intelRuntimeWith1Channel(),
        __channelEngine: engine,
      });

      await handler.channels.ready().catch(() => {});

      // The failed-to-activate breadcrumb must log the Error under `err` (the
      // only key pino serializes an Error's non-enumerable message/stack
      // under). Under any other key it would render as `{}` and the cause
      // would be lost.
      const errBridged = warnSpy.mock.calls.find(
        ([ctx, msg]) =>
          typeof msg === "string" &&
          msg.includes("failed to activate") &&
          ctx !== null &&
          typeof ctx === "object" &&
          (ctx as { err?: unknown }).err instanceof Error,
      );
      expect(errBridged).toBeDefined();
      expect(((errBridged![0] as { err: Error }).err as Error).message).toBe(
        "activation boom",
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
