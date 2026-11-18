import React from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../providers/CopilotChatConfigurationProvider";
import { useCapabilities } from "../use-capabilities";

/**
 * End-to-end regression for issue #5533.
 *
 * `useCapabilities()` is documented to resolve the agent from the surrounding
 * chat configuration when no `agentId` is passed (falling back to the default).
 * It does this by delegating to `useAgent()`, which inherits the chat-config
 * agentId. This test exercises the REAL useAgent (not a mock) to prove the
 * documented inheritance actually holds: a `useCapabilities()` consumer inside
 * a chat configured for a non-default agent must report THAT agent's
 * capabilities, not the (absent) default agent's.
 */

const CAPS = { tools: { supported: true, clientProvided: true } };

const runtimeInfo = {
  version: "1.0.0",
  audioFileTranscriptionEnabled: false,
  // Runtime registers ONLY a non-default agent, with capabilities.
  agents: {
    TravelBookingAgent: {
      name: "TravelBookingAgent",
      description: "Books travel",
      capabilities: CAPS,
    },
  },
};

describe("issue #5533: useCapabilities inherits the chat-config agent", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
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

  it("resolves the configured non-default agent's capabilities with no agentId arg", async () => {
    // Consumer passes NO agentId — it should inherit "TravelBookingAgent" from
    // the surrounding chat configuration, not look up the (unregistered)
    // default agent.
    function CapsConsumer() {
      const caps = useCapabilities();
      return (
        <div data-testid="caps">{caps ? JSON.stringify(caps) : "none"}</div>
      );
    }

    const { getByTestId } = render(
      <CopilotKitProvider runtimeUrl="http://localhost:3000/copilotkit">
        <CopilotChatConfigurationProvider agentId="TravelBookingAgent">
          <CapsConsumer />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    // After the runtime syncs, the inherited agent's capabilities surface.
    await waitFor(() => {
      expect(getByTestId("caps").textContent).toBe(JSON.stringify(CAPS));
    });
  });
});
