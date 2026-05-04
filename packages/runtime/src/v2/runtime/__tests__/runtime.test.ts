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
  const identifyUser = vi.fn().mockResolvedValue({ id: "user-1" });
  const createMockIntelligence = (): CopilotKitIntelligence =>
    ({
      ɵgetRunnerWsUrl: vi.fn().mockReturnValue("ws://runner.example"),
      ɵgetRunnerAuthToken: vi.fn().mockReturnValue("token-123"),
      ɵgetClientWsUrl: vi.fn().mockReturnValue("ws://client.example"),
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
      identifyUser,
    });

    expect(runtime.mode).toBe("intelligence");

    expect(runtime.intelligence).toBe(sdk);
    expect(runtime.runner).toBeInstanceOf(IntelligenceAgentRunner);
    expect(runtime.generateThreadNames).toBe(true);
    expect(runtime.identifyUser).toBe(identifyUser);
    expect(sdk.ɵgetRunnerWsUrl).toHaveBeenCalledTimes(1);
    expect(sdk.ɵgetRunnerAuthToken).toHaveBeenCalledTimes(1);
  });

  it("preserves an explicit generateThreadNames=false option in Intelligence mode", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotIntelligenceRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
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
      identifyUser,
    });

    expect(runtime.mode).toBe("intelligence");

    expect(runtime.intelligence).toBe(sdk);
    expect(runtime.runner).toBeInstanceOf(IntelligenceAgentRunner);
    expect(
      (runtime as CopilotRuntime & { generateThreadNames?: boolean })
        .generateThreadNames,
    ).toBe(true);
    expect(
      (
        runtime as CopilotRuntime & {
          identifyUser?: typeof identifyUser;
        }
      ).identifyUser,
    ).toBe(identifyUser);
  });

  it("forwards generateThreadNames=false through the CopilotRuntime intelligence shim", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
      generateThreadNames: false,
    });

    expect(runtime.mode).toBe("intelligence");
    expect(
      (runtime as CopilotRuntime & { generateThreadNames?: boolean })
        .generateThreadNames,
    ).toBe(false);
  });

  it("exposes identifyUser as undefined for SSE runtimes", () => {
    const runtime = new CopilotRuntime({ agents });

    expect(
      (runtime as CopilotRuntime & { identifyUser?: typeof identifyUser })
        .identifyUser,
    ).toBeUndefined();
  });
});
