import { describe, expect, it, vi } from "vitest";

import {
  CopilotIntelligenceRuntime,
  CopilotRuntime,
  CopilotSseRuntime,
} from "../runtime";
import type { CopilotKitIntelligence } from "../intelligence-platform";
import { InMemoryAgentRunner } from "../runner/in-memory";
import { IntelligenceAgentRunner } from "../runner/intelligence";

describe("runtime construction", () => {
  const agents = {};
  const createMockIntelligence = (): CopilotKitIntelligence =>
    ({
      getRunnerWsUrl: vi.fn().mockReturnValue("ws://runner.example"),
      getRunnerAuthToken: vi.fn().mockReturnValue("token-123"),
      getClientWsUrl: vi.fn().mockReturnValue("ws://client.example"),
    }) as unknown as CopilotKitIntelligence;

  it("builds an SSE runtime by default", () => {
    const runtime = new CopilotSseRuntime({ agents });

    expect(runtime.mode).toBe("sse");

    expect(runtime.runner).toBeInstanceOf(InMemoryAgentRunner);
    expect(runtime.intelligence).toBeUndefined();
  });

  it("builds an Intelligence runtime with an Intelligence runner", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotIntelligenceRuntime({
      agents,
      intelligence: sdk,
    });

    expect(runtime.mode).toBe("intelligence");

    expect(runtime.intelligence).toBe(sdk);
    expect(runtime.runner).toBeInstanceOf(IntelligenceAgentRunner);
    expect(runtime.generateThreadNames).toBe(true);
    expect(sdk.getRunnerWsUrl).toHaveBeenCalledTimes(1);
    expect(sdk.getRunnerAuthToken).toHaveBeenCalledTimes(1);
  });

  it("preserves an explicit generateThreadNames=false option in Intelligence mode", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotIntelligenceRuntime({
      agents,
      intelligence: sdk,
      generateThreadNames: false,
    });

    expect(runtime.generateThreadNames).toBe(false);
  });

  it("keeps CopilotRuntime as an SSE shim when no CopilotKitIntelligence is provided", () => {
    const runtime = new CopilotRuntime({ agents });

    expect(runtime.mode).toBe("sse");

    expect(runtime.runner).toBeInstanceOf(InMemoryAgentRunner);
    expect(runtime.intelligence).toBeUndefined();
  });

  it("keeps CopilotRuntime as an Intelligence shim when CopilotKitIntelligence is provided", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotRuntime({
      agents,
      intelligence: sdk,
    });

    expect(runtime.mode).toBe("intelligence");

    expect(runtime.intelligence).toBe(sdk);
    expect(runtime.runner).toBeInstanceOf(IntelligenceAgentRunner);
  });
});
