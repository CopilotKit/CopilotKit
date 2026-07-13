import { describe, it, expect, vi } from "vitest";
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
  it("activates channels once on creation, not on first request", async () => {
    const { engine, state } = countingEngine();

    const handler = createCopilotRuntimeHandler({
      runtime: intelRuntimeWith1Channel(),
      __channelEngine: engine,
    });

    expect(state.calls).toBe(1);

    await handler(new Request("http://x/api/copilotkit/agents"));

    expect(state.calls).toBe(1);
    expect(handler.channels).toBeDefined();
    await handler.channels!.ready({ timeoutMs: 1000 });
    expect(handler.channels!.status().overall).toBe("online");
    await handler.channels!.stop();
  });

  it("is idempotent per runtime instance across repeated handler creation", () => {
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

    expect(state.calls).toBe(1);
    expect(first.channels).toBeDefined();
    expect(first.channels).toBe(second.channels);
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
});
