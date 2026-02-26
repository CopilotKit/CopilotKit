import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitProvider } from "../CopilotKitProvider";
import { HttpAgent, FilterToolCallsMiddleware } from "@ag-ui/client";

describe("CopilotKitProvider selfManagedAgents", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it("should throw when selfManagedAgents is used without a license key", () => {
    const agent = new HttpAgent({ url: "https://example.com" });

    expect(() => {
      render(
        <CopilotKitProvider selfManagedAgents={{ myAgent: agent }}>
          <div />
        </CopilotKitProvider>,
      );
    }).toThrow(/selfManagedAgents requires a 'publicApiKey' or 'publicLicenseKey'/);
  });

  it("should work when selfManagedAgents is used with a license key", () => {
    const agent = new HttpAgent({ url: "https://example.com" });

    expect(() => {
      render(
        <CopilotKitProvider
          publicApiKey="test-key"
          selfManagedAgents={{ myAgent: agent }}
        >
          <div />
        </CopilotKitProvider>,
      );
    }).not.toThrow();
  });

  it("should throw when selfManagedAgents agent has disallowed middleware", () => {
    const agent = new HttpAgent({ url: "https://example.com" });
    agent.use(new FilterToolCallsMiddleware({ allowedToolCalls: ["search"] }));

    expect(() => {
      render(
        <CopilotKitProvider
          publicApiKey="test-key"
          selfManagedAgents={{ myAgent: agent }}
        >
          <div />
        </CopilotKitProvider>,
      );
    }).toThrow(/FilterToolCallsMiddleware cannot be used with selfManagedAgents/);
  });
});
