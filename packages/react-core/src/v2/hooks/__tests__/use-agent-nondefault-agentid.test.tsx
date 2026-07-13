import React from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../providers/CopilotChatConfigurationProvider";
import { useAgent } from "../use-agent";

/**
 * Reproduction for issue #5533.
 *
 * Reporter setup (v2):
 *   <CopilotKit runtimeUrl="...">          // NO `agent` prop; the runtime
 *                                          // registers an agent under a
 *                                          // NON-default name.
 *     <CopilotChat agentId="TravelBookingAgent" />  // NO `agent` on provider
 *   </CopilotKit>
 *
 * After runtime sync the browser throws:
 *   "useAgent: Agent 'default' not found after runtime sync (runtimeUrl=...).
 *    Known agents: [TravelBookingAgent]"
 *
 * Note: the thrown id is 'default', NOT 'TravelBookingAgent'.
 *
 * Root cause being pinned: useAgent() reads agentId only from its own props,
 * falling back to DEFAULT_AGENT_ID. It does NOT consult the surrounding
 * CopilotChatConfigurationProvider (which CopilotChat populates with the
 * resolved agentId). So any consumer of useAgent() rendered inside the chat
 * subtree — without re-passing agentId — resolves to 'default' and throws once
 * the runtime has synced only the non-default agent.
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
  // Runtime registers the agent under a NON-default name.
  agents: {
    TravelBookingAgent: {
      name: "TravelBookingAgent",
      description: "Books travel",
      capabilities: {},
    },
  },
};

describe("issue #5533: non-default agentId after runtime sync", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
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

  it("useAgent() inside a chat configured for a non-default agent must not throw 'Agent default not found'", async () => {
    const errors: Error[] = [];

    // A consumer that relies on the chat configuration's agentId (i.e. does NOT
    // re-pass agentId), exactly like a custom message-view / tool-render
    // component rendered inside <CopilotChat agentId="TravelBookingAgent">.
    function ChatConfigConsumer() {
      const { agent } = useAgent();
      return <div data-testid="resolved-id">{agent.agentId}</div>;
    }

    const { getByTestId } = render(
      <ErrorBoundary onError={(e) => errors.push(e)}>
        <CopilotKitProvider runtimeUrl="http://localhost:3000/api">
          {/* This provider mirrors what <CopilotChat agentId="..."> installs
              around its subtree: agentId resolved to the non-default name. */}
          <CopilotChatConfigurationProvider agentId="TravelBookingAgent">
            <ChatConfigConsumer />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      </ErrorBoundary>,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    // Let the post-sync re-render run useAgent's resolution again. Wait until
    // either the consumer resolved to the inherited agent id, or an error was
    // captured — so the final assertions run against the settled tree.
    await waitFor(() => {
      const resolved = errors.length === 0 ? getByTestId("resolved-id") : null;
      expect(
        errors.length > 0 || resolved?.textContent === "TravelBookingAgent",
      ).toBe(true);
    });

    const defaultNotFound = errors.find((e) =>
      /Agent 'default' not found/.test(e.message),
    );

    expect(defaultNotFound, defaultNotFound?.message).toBeUndefined();

    // Positive assertion: the consumer must inherit the chat configuration's
    // agentId (TravelBookingAgent), not silently fall back to 'default'.
    expect(getByTestId("resolved-id").textContent).toBe("TravelBookingAgent");
  });

  it("an explicit agentId prop still wins over the surrounding chat configuration", async () => {
    function ExplicitConsumer() {
      // Explicitly request the agent that IS registered, overriding the
      // provider's configured id — the explicit prop must take precedence.
      const { agent } = useAgent({ agentId: "TravelBookingAgent" });
      return <div data-testid="resolved-id">{agent.agentId}</div>;
    }

    const { getByTestId } = render(
      <CopilotKitProvider runtimeUrl="http://localhost:3000/api">
        {/* Provider configured for a DIFFERENT id; the explicit prop wins. */}
        <CopilotChatConfigurationProvider agentId="SomeOtherAgent">
          <ExplicitConsumer />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(getByTestId("resolved-id").textContent).toBe("TravelBookingAgent");
    });
  });
});
