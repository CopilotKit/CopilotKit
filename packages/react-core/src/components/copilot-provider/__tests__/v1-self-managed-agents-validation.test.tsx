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
  // Rendering paths that legitimately have no runtime emit a dev-only warning
  // from the v2 provider; silence it so the test output stays clean.
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function renderKit(props: Partial<CopilotKitProps>) {
    return render(<CopilotKit {...props}>child</CopilotKit>);
  }

  it("throws when no runtimeUrl, key, or local agents are provided", () => {
    expect(() => renderKit({})).toThrow(ConfigurationError);
  });

  it("does not throw when selfManagedAgents is provided without a runtimeUrl", () => {
    const testAgent = new HttpAgent({ url: "http://localhost:8000" });
    expect(() =>
      renderKit({ selfManagedAgents: { testAgent }, agent: "testAgent" }),
    ).not.toThrow();
  });

  it("does not throw when agents__unsafe_dev_only is provided without a runtimeUrl", () => {
    const testAgent = new HttpAgent({ url: "http://localhost:8000" });
    expect(() =>
      renderKit({ agents__unsafe_dev_only: { testAgent }, agent: "testAgent" }),
    ).not.toThrow();
  });
});
