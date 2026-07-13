/**
 * Propagation of `handler.channels` through the endpoint wrappers.
 *
 * `createCopilotRuntimeHandler` activates managed Channels at creation time
 * and exposes the lifecycle control surface as `.channels` on the returned
 * fetch handler (see `handler-channels.test.ts`). This suite asserts that the
 * Node, Express, and Hono wrappers around that handler still activate exactly
 * once, and that Node — the long-running, lifecycle-owning entry point —
 * surfaces `.channels` on its returned listener. Express/Hono attach
 * `.channels` best-effort on their returned framework objects too.
 */
import { describe, it, expect } from "vitest";
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

describe("endpoint wrappers — managed channels propagation", () => {
  it("Node listener exposes .channels and activates exactly once at creation", async () => {
    const { engine, state } = countingEngine();

    const listener = createCopilotNodeListener({
      runtime: intelRuntimeWith1Channel(),
      __channelEngine: engine,
    });

    expect(state.calls).toBe(1);
    expect(listener.channels).toBeDefined();
    await listener.channels!.ready({ timeoutMs: 1000 });
    expect(listener.channels!.status().overall).toBe("online");
    await listener.channels!.stop();
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

  it("Express handler activates once and exposes .channels on the returned Router", async () => {
    const { engine, state } = countingEngine();

    const router = createCopilotExpressHandler({
      runtime: intelRuntimeWith1Channel(),
      basePath: "/api/copilotkit",
      __channelEngine: engine,
    });

    expect(state.calls).toBe(1);
    expect(router.channels).toBeDefined();
    await router.channels!.ready({ timeoutMs: 1000 });
    expect(router.channels!.status().overall).toBe("online");
    await router.channels!.stop();
  });

  it("Hono handler activates once and exposes .channels on the returned app", async () => {
    const { engine, state } = countingEngine();

    const app = createCopilotHonoHandler({
      runtime: intelRuntimeWith1Channel(),
      basePath: "/api/copilotkit",
      __channelEngine: engine,
    });

    expect(state.calls).toBe(1);
    expect(app.channels).toBeDefined();
    await app.channels!.ready({ timeoutMs: 1000 });
    expect(app.channels!.status().overall).toBe("online");
    await app.channels!.stop();
  });
});
