import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CopilotRuntime } from "../copilot-runtime";
import telemetry from "../../telemetry-client";

/**
 * The v1 (GraphQL) CopilotRuntime is a separate endpoint path from the v2
 * runtime, with its own constructor. It already forwards the license token to
 * telemetry — this pins that behavior so the v1 path can't silently regress
 * into anonymous telemetry the way the v2 SSE path did.
 */
describe("v1 CopilotRuntime — telemetry license token", () => {
  // Real JWT shape with telemetry_id so the parser doesn't warn.
  const TOKEN = `header.${Buffer.from('{"telemetry_id":"abc-123"}').toString(
    "base64url",
  )}.sig`;

  let setLicenseTokenSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: string | undefined;

  beforeEach(() => {
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

  it("forwards an explicit licenseToken option to telemetry", () => {
    const runtime = new CopilotRuntime({ agents: {}, licenseToken: TOKEN });

    expect(runtime).toBeInstanceOf(CopilotRuntime);
    expect(setLicenseTokenSpy).toHaveBeenCalledWith(TOKEN);
  });

  it("falls back to COPILOTKIT_LICENSE_TOKEN when no option is given", () => {
    process.env.COPILOTKIT_LICENSE_TOKEN = TOKEN;

    const runtime = new CopilotRuntime({ agents: {} });

    expect(runtime).toBeInstanceOf(CopilotRuntime);
    expect(setLicenseTokenSpy).toHaveBeenCalledWith(TOKEN);
  });

  it("does not set a token when none is provided", () => {
    const runtime = new CopilotRuntime({ agents: {} });

    expect(runtime).toBeInstanceOf(CopilotRuntime);
    expect(setLicenseTokenSpy).not.toHaveBeenCalled();
  });
});
