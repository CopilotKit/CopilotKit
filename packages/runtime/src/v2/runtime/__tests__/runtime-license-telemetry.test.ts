import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CopilotIntelligenceRuntime,
  CopilotRuntime,
  CopilotSseRuntime,
} from "../core/runtime";
import type { CopilotKitIntelligence } from "../intelligence-platform";
import { telemetry } from "../telemetry";

/**
 * Every runtime construction path feeds the same endpoints, and all endpoints
 * share the process-wide `telemetry` singleton. So telemetry attribution is
 * decided entirely at construction time: if the runtime constructor forwards
 * the license token to `telemetry.setLicenseToken`, every downstream event
 * (instance_created, copilot_request_created, agent_execution_*) carries the
 * telemetry_id; if it doesn't, those events are anonymous and sample-gated.
 *
 * Regression guard for the gap where only CopilotIntelligenceRuntime set the
 * token, so self-hosted SSE users never got a telemetry_id on their events.
 */
describe("runtime construction — telemetry license token", () => {
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

  // Real JWT shape with telemetry_id so the parser doesn't warn.
  const TOKEN = `header.${Buffer.from('{"telemetry_id":"abc-123"}').toString(
    "base64url",
  )}.sig`;

  let setLicenseTokenSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Spy with a no-op impl so the shared singleton's identified/anonymous
    // state is never mutated across tests — we assert the call, not state.
    setLicenseTokenSpy = vi
      .spyOn(telemetry, "setLicenseToken")
      .mockImplementation(() => {});
    originalEnv = process.env.COPILOTKIT_LICENSE_TOKEN;
    delete process.env.COPILOTKIT_LICENSE_TOKEN;
  });

  afterEach(() => {
    setLicenseTokenSpy.mockRestore();
    if (originalEnv === undefined) {
      delete process.env.COPILOTKIT_LICENSE_TOKEN;
    } else {
      process.env.COPILOTKIT_LICENSE_TOKEN = originalEnv;
    }
  });

  describe("CopilotSseRuntime (self-hosted, direct)", () => {
    it("forwards an explicit licenseToken option to telemetry", () => {
      const runtime = new CopilotSseRuntime({ agents, licenseToken: TOKEN });

      expect(runtime.mode).toBe("sse");
      expect(setLicenseTokenSpy).toHaveBeenCalledTimes(1);
      expect(setLicenseTokenSpy).toHaveBeenCalledWith(TOKEN);
    });

    it("falls back to COPILOTKIT_LICENSE_TOKEN when no option is given", () => {
      process.env.COPILOTKIT_LICENSE_TOKEN = TOKEN;

      const runtime = new CopilotSseRuntime({ agents });

      expect(runtime.mode).toBe("sse");
      expect(setLicenseTokenSpy).toHaveBeenCalledTimes(1);
      expect(setLicenseTokenSpy).toHaveBeenCalledWith(TOKEN);
    });

    it("does not set a token when none is provided", () => {
      const runtime = new CopilotSseRuntime({ agents });

      expect(runtime.mode).toBe("sse");
      expect(setLicenseTokenSpy).not.toHaveBeenCalled();
    });
  });

  describe("CopilotRuntime shim — SSE delegate (self-hosted, default entrypoint)", () => {
    it("forwards an explicit licenseToken option to telemetry", () => {
      const runtime = new CopilotRuntime({ agents, licenseToken: TOKEN });

      expect(runtime.mode).toBe("sse");
      expect(setLicenseTokenSpy).toHaveBeenCalledTimes(1);
      expect(setLicenseTokenSpy).toHaveBeenCalledWith(TOKEN);
    });

    it("falls back to COPILOTKIT_LICENSE_TOKEN when no option is given", () => {
      process.env.COPILOTKIT_LICENSE_TOKEN = TOKEN;

      const runtime = new CopilotRuntime({ agents });

      expect(runtime.mode).toBe("sse");
      expect(setLicenseTokenSpy).toHaveBeenCalledTimes(1);
      expect(setLicenseTokenSpy).toHaveBeenCalledWith(TOKEN);
    });
  });

  describe("CopilotIntelligenceRuntime (direct)", () => {
    it("forwards the licenseToken exactly once (no double-set after hoist)", () => {
      const runtime = new CopilotIntelligenceRuntime({
        agents,
        intelligence: createMockIntelligence(),
        identifyUser,
        licenseToken: TOKEN,
      });

      expect(runtime.mode).toBe("intelligence");
      expect(setLicenseTokenSpy).toHaveBeenCalledTimes(1);
      expect(setLicenseTokenSpy).toHaveBeenCalledWith(TOKEN);
    });

    it("falls back to COPILOTKIT_LICENSE_TOKEN when no option is given", () => {
      process.env.COPILOTKIT_LICENSE_TOKEN = TOKEN;

      const runtime = new CopilotIntelligenceRuntime({
        agents,
        intelligence: createMockIntelligence(),
        identifyUser,
      });

      expect(runtime.mode).toBe("intelligence");
      expect(setLicenseTokenSpy).toHaveBeenCalledTimes(1);
      expect(setLicenseTokenSpy).toHaveBeenCalledWith(TOKEN);
    });
  });

  describe("CopilotRuntime shim — Intelligence delegate", () => {
    it("forwards the licenseToken exactly once", () => {
      const runtime = new CopilotRuntime({
        agents,
        intelligence: createMockIntelligence(),
        identifyUser,
        licenseToken: TOKEN,
      });

      expect(runtime.mode).toBe("intelligence");
      expect(setLicenseTokenSpy).toHaveBeenCalledTimes(1);
      expect(setLicenseTokenSpy).toHaveBeenCalledWith(TOKEN);
    });
  });
});
