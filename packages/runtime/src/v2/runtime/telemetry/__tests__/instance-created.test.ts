import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { telemetry } from "..";
import { fireInstanceCreatedTelemetry } from "../instance-created";
import type { CopilotRuntimeLike } from "../../core/runtime";

// Minimal runtime stub: we only use `agents` from CopilotRuntimeLike inside
// the helper, so we cast the stub rather than construct a full runtime.
function makeRuntime(
  agents:
    | Record<string, unknown>
    | Promise<Record<string, unknown>>
    | ((ctx: { request: Request }) => Record<string, unknown>),
): CopilotRuntimeLike {
  return { agents } as unknown as CopilotRuntimeLike;
}

describe("fireInstanceCreatedTelemetry", () => {
  let captureSpy: ReturnType<typeof vi.spyOn>;
  let setGlobalsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captureSpy = vi.spyOn(telemetry, "capture").mockResolvedValue(undefined);
    setGlobalsSpy = vi.spyOn(telemetry, "setGlobalProperties");
  });

  afterEach(() => {
    captureSpy.mockRestore();
    setGlobalsSpy.mockRestore();
  });

  it("sets runtime.framework as a global property before capture", async () => {
    fireInstanceCreatedTelemetry({
      runtime: makeRuntime({ a1: {}, a2: {} }),
      framework: "hono",
    });

    await vi.waitFor(() => expect(captureSpy).toHaveBeenCalled());

    expect(setGlobalsSpy).toHaveBeenCalledWith({
      runtime: { framework: "hono" },
    });
  });

  it("captures instance_created with agent count from static agents record", async () => {
    fireInstanceCreatedTelemetry({
      runtime: makeRuntime({ a1: {}, a2: {}, a3: {} }),
      framework: "express",
    });

    await vi.waitFor(() => expect(captureSpy).toHaveBeenCalled());

    expect(captureSpy).toHaveBeenCalledWith("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      agentsAmount: 3,
      "cloud.api_key_provided": false,
    });
  });

  it("awaits Promise-based agents before capturing", async () => {
    fireInstanceCreatedTelemetry({
      runtime: makeRuntime(Promise.resolve({ only: {} })),
      framework: "hono-single",
    });

    await vi.waitFor(() => expect(captureSpy).toHaveBeenCalled());

    const call = captureSpy.mock.calls[0][1] as { agentsAmount: number | null };
    expect(call.agentsAmount).toBe(1);
  });

  it("reports agentsAmount: null when agents is a factory (cannot resolve without request)", async () => {
    fireInstanceCreatedTelemetry({
      runtime: makeRuntime(() => ({ x: {} })),
      framework: "express-single",
    });

    await vi.waitFor(() => expect(captureSpy).toHaveBeenCalled());

    const call = captureSpy.mock.calls[0][1] as { agentsAmount: number | null };
    expect(call.agentsAmount).toBeNull();
  });

  it("does not hardcode cloud.api_key_provided — it is false at handler-creation time by design (key arrives per-request via header)", async () => {
    fireInstanceCreatedTelemetry({
      runtime: makeRuntime({ a1: {} }),
      framework: "hono",
    });

    await vi.waitFor(() => expect(captureSpy).toHaveBeenCalled());

    const call = captureSpy.mock.calls[0][1] as {
      "cloud.api_key_provided": boolean;
    };
    expect(call["cloud.api_key_provided"]).toBe(false);
  });

  it("does not throw or reject when agents Promise rejects", async () => {
    // Swallow the unhandled rejection from the input Promise itself — the
    // Promise we pass in rejects synchronously regardless of whether we
    // attach a .catch downstream.
    const rejectingAgents = Promise.reject(new Error("boom"));
    rejectingAgents.catch(() => {});

    expect(() =>
      fireInstanceCreatedTelemetry({
        runtime: makeRuntime(rejectingAgents as any),
        framework: "hono",
      }),
    ).not.toThrow();

    // Wait a microtask to let the internal catch fire; no capture should happen.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(captureSpy).not.toHaveBeenCalled();
  });
});
