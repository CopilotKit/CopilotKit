import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  CopilotKitIntelligenceRuntime,
  CopilotKitRuntime,
  CopilotKitSseRuntime,
} from "../core/runtime";
import type { CopilotKitIntelligenceRuntimeOptions } from "../core/runtime";
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

  it("exposes Learning configuration only under the experimental marker", () => {
    type HasUnprefixedLearning =
      "learning" extends keyof CopilotKitIntelligenceRuntimeOptions
        ? true
        : false;

    expectTypeOf<HasUnprefixedLearning>().toEqualTypeOf<false>();
  });

  it("builds an SSE runtime by default", () => {
    const runtime = new CopilotKitSseRuntime({ agents });

    expect(runtime.mode).toBe("sse");

    expect(runtime.runner).toBeInstanceOf(InMemoryAgentRunner);
    expect(runtime.intelligence).toBeUndefined();
  });

  it("rejects Learning Container config in SSE mode", () => {
    expect(
      () =>
        new CopilotKitSseRuntime({
          agents,
          ɵlearning: { containerId: "support-quality" },
        } as never),
    ).toThrow("`ɵlearning` requires the Intelligence runtime");
  });

  it("builds an Intelligence runtime with an Intelligence runner", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotKitIntelligenceRuntime({
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

  it("stores one Learning Container resolver for web and Channels", () => {
    const sdk = createMockIntelligence();
    const containerId = vi.fn().mockResolvedValue("support-quality");

    const runtime = new CopilotKitIntelligenceRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
      ɵlearning: { containerId },
    });

    expect(runtime.learning?.containerId).toBe(containerId);
  });

  it.each(["Support Quality", "support--quality", "-support"])(
    "rejects invalid static Learning Container ID %s",
    (containerId) => {
      expect(
        () =>
          new CopilotKitIntelligenceRuntime({
            agents,
            intelligence: createMockIntelligence(),
            identifyUser,
            ɵlearning: { containerId },
          }),
      ).toThrow("stable ID");
    },
  );

  it("preserves an explicit generateThreadNames=false option in Intelligence mode", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotKitIntelligenceRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
      generateThreadNames: false,
    });

    expect(runtime.generateThreadNames).toBe(false);
  });

  it("keeps CopilotKitRuntime as an SSE shim when no CopilotKitIntelligence is provided", () => {
    const runtime = new CopilotKitRuntime({ agents });

    expect(runtime.mode).toBe("sse");

    expect(runtime.runner).toBeInstanceOf(InMemoryAgentRunner);
    expect(runtime.intelligence).toBeUndefined();
  });

  it("keeps CopilotKitRuntime as an Intelligence shim when CopilotKitIntelligence is provided", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotKitRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
    });

    expect(runtime.mode).toBe("intelligence");

    expect(runtime.intelligence).toBe(sdk);
    expect(runtime.runner).toBeInstanceOf(IntelligenceAgentRunner);
    expect(
      (runtime as CopilotKitRuntime & { generateThreadNames?: boolean })
        .generateThreadNames,
    ).toBe(true);
    expect(
      (
        runtime as CopilotKitRuntime & {
          identifyUser?: typeof identifyUser;
        }
      ).identifyUser,
    ).toBe(identifyUser);
  });

  it("forwards generateThreadNames=false through the CopilotKitRuntime intelligence shim", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotKitRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
      generateThreadNames: false,
    });

    expect(runtime.mode).toBe("intelligence");
    expect(
      (runtime as CopilotKitRuntime & { generateThreadNames?: boolean })
        .generateThreadNames,
    ).toBe(false);
  });

  it("exposes identifyUser as undefined for SSE runtimes", () => {
    const runtime = new CopilotKitRuntime({ agents });

    expect(
      (runtime as CopilotKitRuntime & { identifyUser?: typeof identifyUser })
        .identifyUser,
    ).toBeUndefined();
  });

  it("defaults lockTtlSeconds to 20 and lockHeartbeatIntervalSeconds to 15", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotKitIntelligenceRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
    });

    expect(runtime.lockTtlSeconds).toBe(20);
    expect(runtime.lockHeartbeatIntervalSeconds).toBe(15);
  });

  it("clamps lockTtlSeconds to a maximum of 3600 (1 hour)", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotKitIntelligenceRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
      lockTtlSeconds: 7200,
    });

    expect(runtime.lockTtlSeconds).toBe(3600);
  });

  it("clamps lockHeartbeatIntervalSeconds to a maximum of 3000 (50 minutes)", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotKitIntelligenceRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
      lockHeartbeatIntervalSeconds: 5000,
    });

    expect(runtime.lockHeartbeatIntervalSeconds).toBe(3000);
  });

  it("uses provided values when they are within allowed range", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotKitIntelligenceRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
      lockTtlSeconds: 30,
    });

    expect(runtime.lockTtlSeconds).toBe(30);
    expect(runtime.lockHeartbeatIntervalSeconds).toBe(15);
  });

  it("stores lock config on CopilotKitIntelligenceRuntime", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotKitIntelligenceRuntime({
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

  it("forwards lock config through the CopilotKitRuntime intelligence shim", () => {
    const sdk = createMockIntelligence();

    const runtime = new CopilotKitRuntime({
      agents,
      intelligence: sdk,
      identifyUser,
      lockTtlSeconds: 60,
      lockKeyPrefix: "agent",
      lockHeartbeatIntervalSeconds: 20,
    });

    expect(
      (runtime as CopilotKitRuntime & { lockTtlSeconds?: number })
        .lockTtlSeconds,
    ).toBe(60);
    expect(
      (runtime as CopilotKitRuntime & { lockKeyPrefix?: string }).lockKeyPrefix,
    ).toBe("agent");
    expect(
      (runtime as CopilotKitRuntime & { lockHeartbeatIntervalSeconds?: number })
        .lockHeartbeatIntervalSeconds,
    ).toBe(20);
  });

  it("exposes lock config as undefined for SSE runtimes", () => {
    const runtime = new CopilotKitRuntime({ agents });

    expect(
      (runtime as CopilotKitRuntime & { lockTtlSeconds?: number })
        .lockTtlSeconds,
    ).toBeUndefined();
    expect(
      (runtime as CopilotKitRuntime & { lockKeyPrefix?: string }).lockKeyPrefix,
    ).toBeUndefined();
    expect(
      (runtime as CopilotKitRuntime & { lockHeartbeatIntervalSeconds?: number })
        .lockHeartbeatIntervalSeconds,
    ).toBeUndefined();
  });
});
