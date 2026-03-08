import { describe, expect, it, vi } from "vitest";

import {
  CopilotIntelligenceRuntime,
  CopilotRuntime,
  CopilotSseRuntime,
} from "../runtime";
import type { CopilotIntelligenceSdk } from "../intelligence-platform";
import { InMemoryAgentRunner } from "../runner/in-memory";
import { IntelligenceAgentRunner } from "../runner/intelligence";

describe("runtime construction", () => {
  const agents = {};
  const createMockSdk = (): CopilotIntelligenceSdk =>
    ({
      getRunnerWsUrl: vi.fn().mockReturnValue("ws://runner.example"),
      getRunnerAuthToken: vi.fn().mockReturnValue("token-123"),
      getClientWsUrl: vi.fn().mockReturnValue("ws://client.example"),
    }) as unknown as CopilotIntelligenceSdk;

  it("builds an SSE runtime by default", () => {
    const runtime = new CopilotSseRuntime({ agents });

    expect(runtime.mode).toBe("sse");
    expect(runtime.isIntelligenceMode).toBe(false);
    expect(runtime.runner).toBeInstanceOf(InMemoryAgentRunner);
    expect(runtime.intelligenceSdk).toBeUndefined();
  });

  it("builds an Intelligence runtime with an Intelligence runner", () => {
    const sdk = createMockSdk();

    const runtime = new CopilotIntelligenceRuntime({
      agents,
      intelligenceSdk: sdk,
    });

    expect(runtime.mode).toBe("intelligence");
    expect(runtime.isIntelligenceMode).toBe(true);
    expect(runtime.intelligenceSdk).toBe(sdk);
    expect(runtime.runner).toBeInstanceOf(IntelligenceAgentRunner);
    expect(sdk.getRunnerWsUrl).toHaveBeenCalledTimes(1);
    expect(sdk.getRunnerAuthToken).toHaveBeenCalledTimes(1);
  });

  it("keeps CopilotRuntime as an SSE shim when no Intelligence SDK is provided", () => {
    const runtime = new CopilotRuntime({ agents });

    expect(runtime.mode).toBe("sse");
    expect(runtime.isIntelligenceMode).toBe(false);
    expect(runtime.runner).toBeInstanceOf(InMemoryAgentRunner);
    expect(runtime.intelligenceSdk).toBeUndefined();
  });

  it("keeps CopilotRuntime as an Intelligence shim when Intelligence SDK is provided", () => {
    const sdk = createMockSdk();

    const runtime = new CopilotRuntime({
      agents,
      intelligenceSdk: sdk,
    });

    expect(runtime.mode).toBe("intelligence");
    expect(runtime.isIntelligenceMode).toBe(true);
    expect(runtime.intelligenceSdk).toBe(sdk);
    expect(runtime.runner).toBeInstanceOf(IntelligenceAgentRunner);
  });
});
