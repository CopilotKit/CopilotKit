import React from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CopilotKit } from "../copilot-provider/copilotkit";
import { CopilotChat } from "../../v2/components/chat/CopilotChat";

/**
 * Integration regression for issue #5533.
 *
 * Faithful reproduction of the reporter's app
 * (github.com/hansmbakker/bugrepro-copilotkit-5533):
 *
 *   <CopilotKit runtimeUrl="/copilotkit">     // NO `agent` prop
 *     <CopilotChat agentId="backend_tool_rendering" />
 *   </CopilotKit>
 *
 * The v2 `CopilotKit` provider mounts `CopilotListeners` as a SIBLING of
 * {children}, wrapped in a top-level CopilotChatConfigurationProvider seeded
 * with agentId={props.agent ?? "default"}. With no `agent` prop that config is
 * "default", so `CopilotListenersAgentSubscription` binds useAgent('default').
 *
 * The runtime here advertises ONLY a non-default agent
 * ("backend_tool_rendering"). Once the runtime syncs to Connected,
 * getAgent('default') is absent and useAgent('default') throws
 * "Agent 'default' not found", crashing the whole tree — even though the
 * `CopilotChat` subtree is correctly configured for the registered agent.
 *
 * The useAgent chat-config fallback cannot help: the listener is OUTSIDE the
 * CopilotChat subtree, so the nearest config genuinely IS "default".
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

const runtimeInfo = {
  version: "1.0.0",
  audioFileTranscriptionEnabled: false,
  // Runtime registers ONLY a non-default agent.
  agents: {
    backend_tool_rendering: {
      name: "backend_tool_rendering",
      description: "Renders backend tools",
      capabilities: {},
    },
  },
};

describe("issue #5533: CopilotListeners with only a non-default agent registered", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    (globalThis as { window?: unknown }).window =
      (globalThis as any).window ?? {};
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => runtimeInfo,
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

  it("does not crash with \"Agent 'default' not found\" once the runtime syncs", async () => {
    const errors: Error[] = [];

    const { queryByTestId } = render(
      <ErrorBoundary onError={(e) => errors.push(e)}>
        <CopilotKit runtimeUrl="http://localhost:3000/copilotkit">
          <CopilotChat agentId="backend_tool_rendering" />
        </CopilotKit>
      </ErrorBoundary>,
    );

    // Wait for the runtime /info fetch to fire and the post-sync re-render.
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    // Give the Connected re-render a chance to run useAgent('default') again.
    await waitFor(() => {
      const defaultNotFound = errors.find((e) =>
        /Agent 'default' not found/.test(e.message),
      );
      expect(defaultNotFound, defaultNotFound?.message).toBeUndefined();
    });

    // The error boundary must NOT have caught anything.
    expect(queryByTestId("boundary-fallback")).toBeNull();
    const defaultNotFound = errors.find((e) =>
      /Agent 'default' not found/.test(e.message),
    );
    expect(defaultNotFound, defaultNotFound?.message).toBeUndefined();
  });

  it('does not log a "Agent default not found" console warning for the valid setup', async () => {
    // The crash is fixed by resolving to a registered agent — but the listener
    // must also not probe getAgent('default'), which logs a post-sync warning.
    // A valid setup should be silent. (#5533 follow-up.)
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <CopilotKit runtimeUrl="http://localhost:3000/copilotkit">
        <CopilotChat agentId="backend_tool_rendering" />
      </CopilotKit>,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    // Let post-sync re-renders settle, then assert no default-not-found warning.
    await new Promise((r) => setTimeout(r, 0));
    const warned = warnSpy.mock.calls
      .flat()
      .some(
        (arg) => typeof arg === "string" && /Agent default not found/.test(arg),
      );
    expect(warned).toBe(false);
  });
});
