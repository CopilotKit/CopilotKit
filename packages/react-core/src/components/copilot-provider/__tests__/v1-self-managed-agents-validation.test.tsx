import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { ConfigurationError } from "@copilotkit/shared";
import { CopilotKit } from "../copilotkit";
import type { CopilotKitProps } from "../copilotkit-props";

/**
 * Regression coverage for #5417. The v1 <CopilotKit> wrapper used to run a
 * `validateProps` check that threw `ConfigurationError` whenever neither
 * `runtimeUrl` nor a public key was supplied — without considering local
 * (self-managed) agents. That rejected the documented self-managed-agent
 * configuration, even though the underlying v2 CopilotKitProvider accepts it
 * (its `hasLocalAgents` gate). These tests pin the wrapper to the same gate.
 */
describe("v1 <CopilotKit> validateProps → self-managed agents", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // The v2 provider emits a dev-only "missing runtime" warning on some
    // keyless renders; silence that expected noise. console.error is spied and
    // silenced too, so valid configs can be asserted to log nothing while
    // keeping test output clean.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderKit(props: Partial<CopilotKitProps>) {
    return render(<CopilotKit {...props}>child</CopilotKit>);
  }

  // A valid configuration must render without throwing AND without surfacing an
  // unexpected error to the console (which would mean the v2 provider rejected
  // the config another way). Self-contained: clears the spy so callers don't
  // have to track prior console.error calls.
  function expectRendersCleanly(props: Partial<CopilotKitProps>) {
    errorSpy.mockClear();
    expect(() => renderKit(props)).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
  }

  it("throws when no runtimeUrl, key, or local agents are provided", () => {
    expect(() => renderKit({})).toThrow(ConfigurationError);
  });

  it("throws when selfManagedAgents is an empty map", () => {
    expect(() => renderKit({ selfManagedAgents: {} })).toThrow(
      ConfigurationError,
    );
  });

  it("does not throw when selfManagedAgents is provided without a runtimeUrl", () => {
    const testAgent = new HttpAgent({ url: "http://localhost:8000" });
    expectRendersCleanly({
      selfManagedAgents: { testAgent },
      agent: "testAgent",
    });
  });

  it("does not throw when agents__unsafe_dev_only is provided without a runtimeUrl", () => {
    const testAgent = new HttpAgent({ url: "http://localhost:8000" });
    expectRendersCleanly({
      agents__unsafe_dev_only: { testAgent },
      agent: "testAgent",
    });
  });

  it("does not throw on the pre-existing runtimeUrl path", () => {
    expectRendersCleanly({
      runtimeUrl: "http://localhost:3000/api/copilotkit",
    });
  });

  it("does not throw on the pre-existing publicApiKey path", () => {
    expectRendersCleanly({ publicApiKey: "ck_pub_test" });
  });
});
