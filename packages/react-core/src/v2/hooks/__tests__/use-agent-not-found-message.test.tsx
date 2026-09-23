import React from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { useAgent } from "../use-agent";

/**
 * An intelligence-mode runtime without a runtime-level `identifyUser` answers
 * /info with no agents. The "not found" error must name that cause.
 */

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: (e: Error) => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  render() {
    if (this.state.hasError) return <div data-testid="boundary-fallback" />;
    return this.props.children as React.ReactElement;
  }
}

describe("useAgent not-found error", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window =
      (globalThis as any).window ?? {};
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: "1.0.0",
        audioFileTranscriptionEnabled: false,
        agents: {},
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("mentions that intelligence mode hides agents without a runtime-level identifyUser", async () => {
    const errors: Error[] = [];
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    function Consumer() {
      useAgent();
      return null;
    }

    render(
      <ErrorBoundary onError={(e) => errors.push(e)}>
        <CopilotKitProvider runtimeUrl="http://localhost:3000/api">
          <Consumer />
        </CopilotKitProvider>
      </ErrorBoundary>,
    );

    await waitFor(() => expect(errors.length).toBeGreaterThan(0));

    const message = errors[0]!.message;
    expect(message).toContain(
      "useAgent: Agent 'default' not found after runtime sync (runtimeUrl=http://localhost:3000/api). No agents registered.",
    );
    expect(message).toContain(
      " Verify your runtime /info and/or agents__unsafe_dev_only.",
    );
    expect(message).toContain(
      "If the runtime runs in intelligence mode (with `intelligence` options), /info only exposes agents when a runtime-level `identifyUser` is configured.",
    );
  });
});
