/**
 * Integration test: Hono adapter + telemetry.
 *
 * Asserts both ends of the path-to-production chain that the v2 refactor
 * previously broke (2ac4a40b5, 2026-03-29):
 *   1. `oss.runtime.instance_created` fires once per handler factory with
 *      `runtime.framework` correctly set per mode ("hono" / "hono-single").
 *   2. `oss.runtime.copilot_request_created` fires when a real HTTP request
 *      flows through the handler.
 *
 * If either regresses, this test fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

import { telemetry } from "../telemetry";
import { createCopilotHonoHandler } from "../endpoints/hono";
import { CopilotRuntime } from "../core/runtime";

function makeAgent(): AbstractAgent {
  const a: unknown = {
    execute: async () => ({ events: [] }),
  };
  (a as { clone: () => unknown }).clone = () => makeAgent();
  return a as AbstractAgent;
}

describe("Hono adapter — telemetry firing (integration)", () => {
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

  it("fires instance_created on handler creation (multi-route)", async () => {
    const runtime = new CopilotRuntime({ agents: { default: makeAgent() } });
    createCopilotHonoHandler({ runtime, basePath: "/" });

    await vi.waitFor(() => {
      expect(captureSpy).toHaveBeenCalledWith(
        "oss.runtime.instance_created",
        expect.objectContaining({
          agentsAmount: 1,
          actionsAmount: 0,
          endpointsAmount: 0,
          "cloud.api_key_provided": false,
        }),
      );
    });
  });

  it("tags subsequent events with framework=hono for multi-route mode", () => {
    const runtime = new CopilotRuntime({ agents: { default: makeAgent() } });
    createCopilotHonoHandler({ runtime, basePath: "/" });

    expect(setGlobalsSpy).toHaveBeenCalledWith({
      runtime: { framework: "hono" },
    });
  });

  it("tags events with framework=hono-single when mode is single-route", () => {
    const runtime = new CopilotRuntime({ agents: { default: makeAgent() } });
    createCopilotHonoHandler({
      runtime,
      basePath: "/api/copilotkit",
      mode: "single-route",
    });

    expect(setGlobalsSpy).toHaveBeenCalledWith({
      runtime: { framework: "hono-single" },
    });
  });

  it("fires copilot_request_created when a real HTTP request hits the handler", async () => {
    const runtime = new CopilotRuntime({ agents: { default: makeAgent() } });
    const endpoint = createCopilotHonoHandler({ runtime, basePath: "/" });

    await endpoint.fetch(
      new Request("https://example.com/agent/default/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [], state: {}, threadId: "t1" }),
      }),
    );

    expect(captureSpy).toHaveBeenCalledWith(
      "oss.runtime.copilot_request_created",
      expect.objectContaining({
        requestType: "run",
        "cloud.api_key_provided": false,
      }),
    );
  });

  it("includes cloud.public_api_key on request when header is present", async () => {
    const runtime = new CopilotRuntime({ agents: { default: makeAgent() } });
    const endpoint = createCopilotHonoHandler({ runtime, basePath: "/" });

    await endpoint.fetch(
      new Request("https://example.com/agent/default/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-copilotcloud-public-api-key": "ck_pub_test_123",
        },
        body: JSON.stringify({ messages: [], state: {}, threadId: "t1" }),
      }),
    );

    expect(captureSpy).toHaveBeenCalledWith(
      "oss.runtime.copilot_request_created",
      expect.objectContaining({
        "cloud.api_key_provided": true,
        "cloud.public_api_key": "ck_pub_test_123",
      }),
    );
  });
});
