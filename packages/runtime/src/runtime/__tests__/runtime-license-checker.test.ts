import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CopilotIntelligenceRuntime,
  CopilotRuntime,
  CopilotSseRuntime,
} from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform";

const verifier = vi.hoisted(() => ({
  createLicenseChecker: vi.fn(),
}));

vi.mock("@copilotkit/license-verifier", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@copilotkit/license-verifier")>();
  verifier.createLicenseChecker.mockImplementation(actual.createLicenseChecker);
  return { ...actual, createLicenseChecker: verifier.createLicenseChecker };
});

function intelligenceOptions(licenseToken?: string) {
  return {
    agents: {},
    intelligence: new CopilotKitIntelligence({
      apiUrl: "https://api.example.com",
      wsUrl: "wss://ws.example.com",
      apiKey: "cpk-project-key",
    }),
    identifyUser: () => ({ id: "user-1", name: "User One" }),
    licenseToken,
  };
}

// License verification must wait for the first request: the edge-safe
// verifier is async, and Cloudflare Workers reject crypto work in global
// scope, where runtimes are usually constructed.
describe("runtime license checker", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.COPILOTKIT_LICENSE_TOKEN;
    delete process.env.COPILOTKIT_LICENSE_TOKEN;
    verifier.createLicenseChecker.mockClear();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.COPILOTKIT_LICENSE_TOKEN;
    } else {
      process.env.COPILOTKIT_LICENSE_TOKEN = originalEnv;
    }
  });

  it("does not verify the license while the runtime is constructed", () => {
    new CopilotIntelligenceRuntime(intelligenceOptions("token-a"));
    new CopilotRuntime(intelligenceOptions("token-b"));

    expect(verifier.createLicenseChecker).not.toHaveBeenCalled();
  });

  it("verifies once on first use and reuses the result", async () => {
    const runtime = new CopilotIntelligenceRuntime(
      intelligenceOptions("token-a"),
    );

    const [first, second] = await Promise.all([
      runtime.getLicenseChecker(),
      runtime.getLicenseChecker(),
    ]);

    expect(first).toBe(second);
    expect(await runtime.getLicenseChecker()).toBe(first);
    expect(verifier.createLicenseChecker).toHaveBeenCalledTimes(1);
    expect(verifier.createLicenseChecker).toHaveBeenCalledWith("token-a");
  });

  it("verifies the environment token when no option is given", async () => {
    process.env.COPILOTKIT_LICENSE_TOKEN = "env-token";
    const runtime = new CopilotIntelligenceRuntime(intelligenceOptions());

    await runtime.getLicenseChecker();

    expect(verifier.createLicenseChecker).toHaveBeenCalledWith("env-token");
  });

  it("delegates from the CopilotRuntime shim to its Intelligence runtime", async () => {
    const runtime = new CopilotRuntime(intelligenceOptions("token-a"));

    const checker = await runtime.getLicenseChecker();

    expect(checker).toBeDefined();
    expect(await runtime.getLicenseChecker()).toBe(checker);
    expect(verifier.createLicenseChecker).toHaveBeenCalledTimes(1);
  });

  it("resolves no checker for runtimes without Intelligence", async () => {
    const sse = new CopilotSseRuntime({ agents: {} });
    const shim = new CopilotRuntime({ agents: {} });

    expect(await sse.getLicenseChecker()).toBeUndefined();
    expect(await shim.getLicenseChecker()).toBeUndefined();
    expect(verifier.createLicenseChecker).not.toHaveBeenCalled();
  });
});
