import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { useAgent, UseAgentUpdate } from "../use-agent";
import { stubWindowLocation } from "../../../v1-deprecated/test-helpers/stub-window-location";

import { EventType } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
} from "../../__tests__/utils/test-helpers";

describe("useAgent error state", () => {
  const originalFetch = global.fetch;
  let restoreLocation: () => void = () => {};

  beforeEach(() => {
    // Make the auto-open-inspector heuristic skip by clearing window.location
    // (keeps the real jsdom window so React 18's renderer stays intact).
    restoreLocation = stubWindowLocation();
    // Mock fetch to reject (simulates runtime unreachable)
    global.fetch = vi.fn().mockRejectedValue(new Error("network failure"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    restoreLocation();
  });

  it("renders a successor run as busy after a live error using only run-status notifications", async () => {
    const agent = new MockStepwiseAgent();
    agent.isRunning = true;
    const input: RunAgentInput = {
      threadId: agent.threadId,
      runId: "successor",
      messages: [],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    };
    function RunStatus() {
      const { agent: observedAgent } = useAgent({
        updates: [UseAgentUpdate.OnRunStatusChanged],
      });
      return <div data-testid="busy">{String(observedAgent.isRunning)}</div>;
    }
    renderWithCopilotKit({ agent, children: <RunStatus /> });
    expect(screen.getByTestId("busy").textContent).toBe("true");
    await act(async () => {
      agent.isRunning = false;
      for (const subscriber of agent.subscribers) {
        await subscriber.onRunErrorEvent?.({
          event: { type: EventType.RUN_ERROR, message: "Live failure" },
          agent,
          input,
          messages: agent.messages,
          state: agent.state,
        });
      }
    });
    expect(screen.getByTestId("busy").textContent).toBe("false");
    await act(async () => {
      agent.isRunning = true;
      for (const subscriber of agent.subscribers) {
        await subscriber.onRunStartedEvent?.({
          event: {
            type: EventType.RUN_STARTED,
            threadId: agent.threadId,
            runId: "successor",
          },
          agent,
          input,
          messages: agent.messages,
          state: agent.state,
        });
      }
    });
    expect(screen.getByTestId("busy").textContent).toBe("true");
  });

  it("returns a provisional agent instead of throwing when runtime is in error state", async () => {
    function TestComponent() {
      const { agent } = useAgent({ agentId: "nonexistent" });
      return <div data-testid="agent-id">{agent.agentId}</div>;
    }

    render(
      <CopilotKitProvider runtimeUrl="http://localhost:59999/nonexistent">
        <TestComponent />
      </CopilotKitProvider>,
    );

    // Should render without crashing — agent is provisional
    const el = await screen.findByTestId("agent-id");
    expect(el.textContent).toBe("nonexistent");
  });
});
