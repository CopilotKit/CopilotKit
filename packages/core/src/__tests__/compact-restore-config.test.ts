import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { CopilotKitCore } from "../core";
import { waitForCondition } from "./test-utils";

describe("compact restore configuration", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("defaults on and propagates an opt-out to registered proxies", () => {
    expect(new CopilotKitCore({}).compactRestore).toBe(true);

    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      compactRestore: false,
    });
    const { agent } = core.registerProxiedAgent({
      agentId: "chat-1",
      runtimeAgentId: "default",
    });

    expect(core.compactRestore).toBe(false);
    expect(agent.compactRestore).toBe(false);
  });

  it("propagates an opt-out to runtime-discovered proxies", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        version: "1.0.0",
        mode: "intelligence",
        intelligence: { wsUrl: "wss://runtime.example/client" },
        agents: { default: { description: "assistant", capabilities: {} } },
      }),
    }) as unknown as typeof fetch;

    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      runtimeTransport: "rest",
      compactRestore: false,
    });
    await waitForCondition(() => core.getAgent("default") !== undefined);

    const discovered = core.getAgent("default");
    expect(discovered).toBeInstanceOf(ProxiedCopilotRuntimeAgent);
    expect((discovered as ProxiedCopilotRuntimeAgent).compactRestore).toBe(
      false,
    );
  });
});
