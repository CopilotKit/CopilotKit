import { describe, expect, it, vi } from "vitest";

import {
  CopilotIntelligenceRuntime,
  CopilotRuntime,
  CopilotSseRuntime,
} from "../core/runtime";
import type { CopilotKitIntelligence } from "../intelligence-platform";
import { InMemoryAgentRunner } from "../runner/in-memory";
import { IntelligenceAgentRunner } from "../runner/intelligence";

describe("runtime construction", () => {
  const agents = {};
  const identifyUser = vi
    .fn()
    .mockResolvedValue({ id: "user-1", name: "User One" });
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

  it("defaults lockTtlSeconds to 20 and lockHeartbeatIntervalSeconds to 15", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotIntelligenceRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
    });

    expect(runtime.lockTtlSeconds).toBe(20);
    expect(runtime.lockHeartbeatIntervalSeconds).toBe(15);
  });

  it("clamps lockTtlSeconds to a maximum of 3600 (1 hour)", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotIntelligenceRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
      lockTtlSeconds: 7200,
    });

    expect(runtime.lockTtlSeconds).toBe(3600);
  });

  it("clamps lockHeartbeatIntervalSeconds to a maximum of 3000 (50 minutes)", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotIntelligenceRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
      lockHeartbeatIntervalSeconds: 5000,
    });

    expect(runtime.lockHeartbeatIntervalSeconds).toBe(3000);
  });

  it("uses provided values when they are within allowed range", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotIntelligenceRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
      lockTtlSeconds: 30,
    });

    expect(runtime.lockTtlSeconds).toBe(30);
    expect(runtime.lockHeartbeatIntervalSeconds).toBe(15);
  });

  it("stores lock config on CopilotIntelligenceRuntime", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotIntelligenceRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
      lockTtlSeconds: 30,
      lockKeyPrefix: "custom",
      lockHeartbeatIntervalSeconds: 10,
    });

    expect(runtime.lockTtlSeconds).toBe(30);
    expect(runtime.lockKeyPrefix).toBe("custom");
    expect(runtime.lockHeartbeatIntervalSeconds).toBe(10);
  });

  it("forwards lock config through the CopilotRuntime intelligence shim", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
      lockTtlSeconds: 60,
      lockKeyPrefix: "agent",
      lockHeartbeatIntervalSeconds: 20,
    });

    expect(
      (runtime as CopilotRuntime & { lockTtlSeconds?: number }).lockTtlSeconds,
    ).toBe(60);
    expect(
      (runtime as CopilotRuntime & { lockKeyPrefix?: string }).lockKeyPrefix,
    ).toBe("agent");
    expect(
      (runtime as CopilotRuntime & { lockHeartbeatIntervalSeconds?: number })
        .lockHeartbeatIntervalSeconds,
    ).toBe(20);
  });

  it("exposes lock config as undefined for SSE runtimes", () => {
    const runtime = new CopilotRuntime({ agents });

    expect(
      (runtime as CopilotRuntime & { lockTtlSeconds?: number }).lockTtlSeconds,
    ).toBeUndefined();
    expect(
      (runtime as CopilotRuntime & { lockKeyPrefix?: string }).lockKeyPrefix,
    ).toBeUndefined();
    expect(
      (runtime as CopilotRuntime & { lockHeartbeatIntervalSeconds?: number })
        .lockHeartbeatIntervalSeconds,
    ).toBeUndefined();
  });
});
