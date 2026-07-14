import { describe, it, expect, vi } from "vitest";
import { AbstractAgent } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/core";
import type { Observable } from "rxjs";
import type { BaseEvent } from "@ag-ui/client";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { CopilotRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform";
import { createChannel } from "@copilotkit/channels";
import type {
  ActivateChannelEngine,
  ChannelsHandle,
} from "../core/channel-manager";
import type { ChannelActivationConfig } from "../core/channel-activation-config";

/* ------------------------------------------------------------------------------------------------
 * This suite proves handler-owned Channel activation end-to-end: a real
 * `createCopilotRuntimeHandler` drives a real `ChannelManager`, which derives a
 * real `ChannelActivationConfig` via `deriveChannelActivationConfig`, and hands
 * it to a FAKE `__channelEngine` — never touching the real Realtime Gateway
 * launcher (`@copilotkit/channels-intelligence` is intentionally not imported
 * here; its wire/topic shape is covered by that package's own tests).
 * --------------------------------------------------------------------------------------------- */

/**
 * Minimal `AbstractAgent` subclass for `createChannel({ agent })`. Its `run`
 * is never invoked — Channel activation only reads `channel.name` — so it
 * simply throws if ever called.
 */
class FakeAgent extends AbstractAgent {
  run(_input: RunAgentInput): Observable<BaseEvent> {
    throw new Error("FakeAgent.run unused in this integration test");
  }
}

/** Fake Intelligence client with known, fixed runner ws/auth accessors. */
function fakeIntelligence(): CopilotKitIntelligence {
  return new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey: "cpk-77_short_long",
  });
}

/**
 * A fake activation engine that captures every `(config, channel)` call it
 * receives and returns a controllable fake {@link ChannelsHandle}: a counting
 * `stop`, and an `onClose` seam that stashes the callback the manager
 * registers so the test can simulate a dropped session.
 */
function capturingEngine(): {
  engine: ActivateChannelEngine;
  calls: { config: ChannelActivationConfig; channelName: string | undefined }[];
  stopCalls: number;
  triggerClose: () => void;
} {
  const calls: {
    config: ChannelActivationConfig;
    channelName: string | undefined;
  }[] = [];
  let stopCalls = 0;
  let capturedOnClose: (() => void) | undefined;

  const engine: ActivateChannelEngine = async (config, channel) => {
    calls.push({ config, channelName: channel.name });
    const handle: ChannelsHandle = {
      metadata: {},
      stop: async () => {
        stopCalls += 1;
      },
      onClose: (cb) => {
        capturedOnClose = cb;
      },
    };
    return handle;
  };

  return {
    engine,
    calls,
    get stopCalls() {
      return stopCalls;
    },
    triggerClose: () => {
      capturedOnClose?.();
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Tests
 * --------------------------------------------------------------------------------------------- */

describe("createCopilotRuntimeHandler — channel activation (integration)", () => {
  it("derives config purely from the intelligence config + channel, with no infra IDs, and drives ready/reconnect/stop through the real ChannelManager", async () => {
    const intelligence = fakeIntelligence();
    const identifyUser = vi.fn().mockResolvedValue({ id: "u", name: "U" });
    const agent = new FakeAgent();
    const runtime = new CopilotRuntime({
      agents: {},
      intelligence,
      identifyUser,
      channels: [createChannel({ name: "support", agent })],
    });

    const state = capturingEngine();

    const handler = createCopilotRuntimeHandler({
      runtime,
      __channelEngine: state.engine,
    });

    // 1. Activation is LAZY: creating the handler opens no socket and makes no
    // engine call (serverless-safe). The control surface exists and reads a
    // truthful, not-yet-online status.
    expect(state.calls.length).toBe(0);
    expect(handler.channels).toBeDefined();
    expect(handler.channels!.status().overall).not.toBe("online");

    // 2. The first request does NOT trigger activation either.
    await handler(new Request("http://x/api/copilotkit/agents"));
    expect(state.calls.length).toBe(0);

    // 3. ready() triggers activation exactly once; the config is derived purely
    // from the intelligence config + channel.
    await handler.channels!.ready({ timeoutMs: 1000 });
    expect(state.calls.length).toBe(1);
    const { config } = state.calls[0]!;
    expect(config.projectId).toBe(77);
    expect(config.channelName).toBe("support");
    expect(state.calls[0]!.channelName).toBe("support");
    expect(config.adapter).toBe("slack");
    expect(config.wsUrl).toBe(intelligence.ɵgetRunnerWsUrl());
    expect(config.apiKey).toBe(intelligence.ɵgetRunnerAuthToken());
    expect(config.runtimeInstanceId).toMatch(/^rti_/);

    // 4. No infrastructure IDs on the derived config — the "no infra IDs"
    // acceptance proof at the SDK boundary.
    expect("organizationId" in config).toBe(false);
    expect("channelId" in config).toBe(false);

    // 5. status is online after ready().
    expect(handler.channels!.status().overall).toBe("online");

    // 6. Drop: simulate a dropped managed session via the captured onClose
    // callback. Reconnection is delegated to the Phoenix connection layer (the
    // launcher's socket auto-rejoins under the persistent adapter), so the
    // manager does NOT re-activate on a drop — it stays `online` and makes no
    // further engine call. See `core/__tests__/channel-manager-reconnect.test.ts`.
    state.triggerClose();
    expect(handler.channels!.status().overall).toBe("online");
    expect(state.calls.length).toBe(1);

    // 7. stop() resolves and the fake handle's stop was invoked.
    await handler.channels!.stop();
    expect(state.stopCalls).toBe(1);
  });
});
