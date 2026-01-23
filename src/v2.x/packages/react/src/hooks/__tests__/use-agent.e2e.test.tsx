import React, { useState, useCallback, useEffect, useRef } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type BaseEvent, type RunAgentInput, type State } from "@ag-ui/client";
import { Observable } from "rxjs";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
  runFinishedEvent,
  textChunkEvent,
  testId,
} from "@/__tests__/utils/test-helpers";
import { useAgent } from "../use-agent";
import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { CopilotKitProvider } from "@/providers/CopilotKitProvider";
import { CopilotChat } from "@/components/chat/CopilotChat";

/**
 * Record of a single agent invocation with its state
 */
interface AgentInvocation {
  runId: string;
  state: State;
  timestamp: number;
}

/**
 * Mock agent that captures ALL RunAgentInputs to verify state across sequential runs.
 * This is used to detect stale state bugs where a subsequent run receives
 * old state instead of the updated state.
 */
class StateCapturingMockAgent extends MockStepwiseAgent {
  public lastRunInput?: RunAgentInput;
  public allInvocations: AgentInvocation[] = [];
  private runCounter = 0;

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.lastRunInput = input;
    this.allInvocations.push({
      runId: `run-${++this.runCounter}`,
      state: JSON.parse(JSON.stringify(input.state ?? {})),
      timestamp: Date.now(),
    });
    return super.run(input);
  }

  /**
   * Get all states received across all invocations
   */
  getAllStates(): State[] {
    return this.allInvocations.map((inv) => inv.state);
  }

  /**
   * Clear invocations for fresh test
   */
  clearInvocations(): void {
    this.allInvocations = [];
    this.runCounter = 0;
    this.lastRunInput = undefined;
  }
}

describe("useAgent e2e", () => {
  describe("setState passes state to agent run", () => {
    it("agent receives state set via setState when runAgent is called", async () => {
      const agent = new StateCapturingMockAgent();

      /**
       * Test component that:
       * 1. Gets agent via useAgent()
       * 2. Gets copilotkit via useCopilotKit()
       * 3. Sets state on agent and calls runAgent
       */
      function StateTestComponent() {
        const { agent: hookAgent } = useAgent();
        const { copilotkit } = useCopilotKit();

        const handleSetStateAndRun = async () => {
          hookAgent.setState({ testKey: "testValue", counter: 42 });
          await copilotkit.runAgent({ agent: hookAgent });
        };

        return (
          <button data-testid="trigger-btn" onClick={handleSetStateAndRun}>
            Set State and Run
          </button>
        );
      }

      renderWithCopilotKit({
        agent,
        children: <StateTestComponent />,
      });

      // Click the button to set state and trigger runAgent
      const triggerBtn = await screen.findByTestId("trigger-btn");
      fireEvent.click(triggerBtn);

      // Wait for the agent's run method to be called
      await waitFor(() => {
        expect(agent.lastRunInput).toBeDefined();
      });

      // Complete the agent run
      agent.emit(runStartedEvent());
      agent.emit(runFinishedEvent());
      agent.complete();

      // Verify the state was passed to the agent
      expect(agent.lastRunInput?.state).toEqual({
        testKey: "testValue",
        counter: 42,
      });
    });
  });

  describe("addMessage + runAgent displays in CopilotChat", () => {
    it("messages added via useAgent show up in CopilotChat", async () => {
      const agent = new MockStepwiseAgent();

      /**
       * Test component that:
       * 1. Gets agent via useAgent()
       * 2. Gets copilotkit via useCopilotKit()
       * 3. Adds a user message and calls runAgent
       */
      function MessageTestComponent() {
        const { agent: hookAgent } = useAgent();
        const { copilotkit } = useCopilotKit();

        const handleAddMessageAndRun = async () => {
          hookAgent.addMessage({
            id: testId("user-msg"),
            role: "user",
            content: "Hello from useAgent!",
          });
          await copilotkit.runAgent({ agent: hookAgent });
        };

        return (
          <div>
            <button data-testid="send-btn" onClick={handleAddMessageAndRun}>
              Send Message
            </button>
            <div style={{ height: 400 }}>
              <CopilotChat />
            </div>
          </div>
        );
      }

      renderWithCopilotKit({
        agent,
        children: <MessageTestComponent />,
      });

      // Click the button to add message and trigger runAgent
      const sendBtn = await screen.findByTestId("send-btn");
      fireEvent.click(sendBtn);

      // User message should appear in the chat
      await waitFor(() => {
        expect(screen.getByText("Hello from useAgent!")).toBeDefined();
      });

      // Simulate agent response
      const responseId = testId("assistant-msg");
      agent.emit(runStartedEvent());
      agent.emit(textChunkEvent(responseId, "Hello! I received your message."));
      agent.emit(runFinishedEvent());
      agent.complete();

      // Assistant response should appear in the chat
      await waitFor(() => {
        expect(screen.getByText("Hello! I received your message.")).toBeDefined();
      });
    });
  });

  describe("Sequential runs with state changes (stale state bug)", () => {
    it("should receive updated state on second run, not stale state from first run", async () => {
      const agent = new StateCapturingMockAgent();

      /**
       * Test component that simulates:
       * 1. First run with state A
       * 2. State change to B
       * 3. Second run should receive state B
       *
       * This replicates the "dojo shared state" bug where subsequent runs
       * receive stale state instead of updated state.
       */
      function SequentialRunsTestComponent() {
        const { agent: hookAgent } = useAgent();
        const { copilotkit } = useCopilotKit();
        const [runCount, setRunCount] = useState(0);

        const handleFirstRun = useCallback(async () => {
          hookAgent.setState({ spicy: true, count: 1 });
          await copilotkit.runAgent({ agent: hookAgent });
          setRunCount(1);
        }, [hookAgent, copilotkit]);

        const handleSecondRun = useCallback(async () => {
          // Change state BEFORE second run
          hookAgent.setState({ spicy: false, count: 2 });
          await copilotkit.runAgent({ agent: hookAgent });
          setRunCount(2);
        }, [hookAgent, copilotkit]);

        return (
          <div>
            <button data-testid="first-run-btn" onClick={handleFirstRun}>
              First Run (spicy=true)
            </button>
            <button data-testid="second-run-btn" onClick={handleSecondRun}>
              Second Run (spicy=false)
            </button>
            <div data-testid="run-count">{runCount}</div>
          </div>
        );
      }

      renderWithCopilotKit({
        agent,
        children: <SequentialRunsTestComponent />,
      });

      // First run with spicy=true
      const firstRunBtn = await screen.findByTestId("first-run-btn");
      fireEvent.click(firstRunBtn);

      await waitFor(() => {
        expect(agent.allInvocations).toHaveLength(1);
      });

      // Complete first run
      agent.emit(runStartedEvent());
      agent.emit(runFinishedEvent());
      agent.complete();

      await waitFor(() => {
        expect(screen.getByTestId("run-count").textContent).toBe("1");
      });

      // Verify first run received correct state
      expect(agent.allInvocations[0]!.state.spicy).toBe(true);
      expect(agent.allInvocations[0]!.state.count).toBe(1);

      // Second run with spicy=false
      const secondRunBtn = await screen.findByTestId("second-run-btn");
      fireEvent.click(secondRunBtn);

      await waitFor(() => {
        expect(agent.allInvocations).toHaveLength(2);
      });

      // Complete second run
      agent.emit(runStartedEvent());
      agent.emit(runFinishedEvent());
      agent.complete();

      await waitFor(() => {
        expect(screen.getByTestId("run-count").textContent).toBe("2");
      });

      // CRITICAL: Verify second run received UPDATED state, not stale state
      expect(agent.allInvocations[1]!.state.spicy).toBe(false);
      expect(agent.allInvocations[1]!.state.count).toBe(2);

      // Ensure we didn't receive duplicate invocations
      expect(agent.allInvocations).toHaveLength(2);
    });

    it("should not invoke agent multiple times for a single run request", async () => {
      const agent = new StateCapturingMockAgent();

      function SingleInvocationTestComponent() {
        const { agent: hookAgent } = useAgent();
        const { copilotkit } = useCopilotKit();

        const handleRun = useCallback(async () => {
          hookAgent.setState({ value: "test" });
          await copilotkit.runAgent({ agent: hookAgent });
        }, [hookAgent, copilotkit]);

        return (
          <button data-testid="run-btn" onClick={handleRun}>
            Run Agent
          </button>
        );
      }

      renderWithCopilotKit({
        agent,
        children: <SingleInvocationTestComponent />,
      });

      const runBtn = await screen.findByTestId("run-btn");
      fireEvent.click(runBtn);

      await waitFor(() => {
        expect(agent.allInvocations).toHaveLength(1);
      });

      // Complete the run
      agent.emit(runStartedEvent());
      agent.emit(runFinishedEvent());
      agent.complete();

      // Give some time for any potential duplicate invocations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should still only have one invocation
      expect(agent.allInvocations).toHaveLength(1);
    });

    it("should handle rapid state changes before run", async () => {
      const agent = new StateCapturingMockAgent();

      function RapidStateChangesTestComponent() {
        const { agent: hookAgent } = useAgent();
        const { copilotkit } = useCopilotKit();

        const handleRapidChangesAndRun = useCallback(async () => {
          // Rapidly change state multiple times before running
          hookAgent.setState({ value: 1 });
          hookAgent.setState({ value: 2 });
          hookAgent.setState({ value: 3 });
          hookAgent.setState({ value: 4 });
          hookAgent.setState({ value: 5 }); // Final state

          await copilotkit.runAgent({ agent: hookAgent });
        }, [hookAgent, copilotkit]);

        return (
          <button data-testid="rapid-btn" onClick={handleRapidChangesAndRun}>
            Rapid Changes and Run
          </button>
        );
      }

      renderWithCopilotKit({
        agent,
        children: <RapidStateChangesTestComponent />,
      });

      const rapidBtn = await screen.findByTestId("rapid-btn");
      fireEvent.click(rapidBtn);

      await waitFor(() => {
        expect(agent.allInvocations).toHaveLength(1);
      });

      // Complete the run
      agent.emit(runStartedEvent());
      agent.emit(runFinishedEvent());
      agent.complete();

      // Agent should receive the FINAL state value (5), not any intermediate values
      expect(agent.allInvocations[0]!.state.value).toBe(5);
    });
  });

  describe("Thread ID stability (multiple threadId bug)", () => {
    /**
     * This test verifies that useAgent returns a stable threadId for provisional agents
     * during the connection phase (Disconnected -> Connecting).
     *
     * BUG: When using useAgent with a runtimeUrl, the hook creates provisional agents
     * while the connection status changes (Disconnected -> Connecting -> Connected).
     * Each time the useMemo re-runs due to dependency changes, a new ProxiedCopilotRuntimeAgent
     * is created WITHOUT passing a threadId, causing AbstractAgent's constructor to
     * generate a new UUID each time.
     *
     * This results in multiple threadIds being logged during initialization:
     * - threadId b3c6091f-6c92-42bb-b879-8fcb6b8bdfc4
     * - threadId 6ec30855-3878-469e-a832-8828860f2ef9
     * - threadId 9718d1f0-62eb-46fe-beb5-13ac462dfb77
     * - ... etc
     *
     * The fix should ensure that the same threadId is used across all provisional agents.
     * Note: When the runtime connects successfully, the registry agent will have its own
     * threadId, which is expected behavior (2 threadIds total: provisional + registry).
     */
    it("should maintain stable threadId for provisional agents during connection phase", async () => {
      // Track threadIds during the provisional phase (before connection completes)
      const provisionalThreadIds: string[] = [];
      let connectionCompleted = false;

      // Mock fetch to control timing - delay /info to capture provisional behavior
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        // Simulate /info endpoint response with a delay
        if (url.includes("/info")) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          connectionCompleted = true;
          return {
            ok: true,
            json: async () => ({
              agents: {
                default: { description: "Test agent" },
              },
              version: "1.0.0",
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      const originalFetch = global.fetch;
      global.fetch = mockFetch;

      /**
       * Test component that captures threadIds during the provisional phase
       */
      function ThreadIdTracker() {
        const { agent } = useAgent({ agentId: "default" });

        // Only capture threadIds during provisional phase (before connection)
        if (agent?.threadId && !connectionCompleted) {
          provisionalThreadIds.push(agent.threadId);
        }

        return (
          <div>
            <div data-testid="thread-id">{agent?.threadId ?? "no-thread"}</div>
          </div>
        );
      }

      // Render with runtimeUrl to trigger the connection flow
      render(
        <CopilotKitProvider runtimeUrl="http://localhost:3000/api/copilotkit">
          <ThreadIdTracker />
        </CopilotKitProvider>
      );

      // Allow time for provisional phase and connection
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

      // Restore original fetch
      global.fetch = originalFetch;

      // CRITICAL ASSERTION: All provisional threadIds should be the same
      // Before the fix, each useMemo re-run created a new threadId
      // After the fix, all provisional agents share the same threadId
      const uniqueProvisionalThreadIds = [...new Set(provisionalThreadIds)];

      console.log("Provisional threadIds:", provisionalThreadIds);
      console.log("Unique provisional threadIds:", uniqueProvisionalThreadIds);

      // Should have exactly 1 unique threadId during the provisional phase
      expect(uniqueProvisionalThreadIds.length).toBeLessThanOrEqual(1);
    });

    it("should not generate multiple threadIds on initial mount", async () => {
      const observedThreadIds: string[] = [];

      // Mock fetch to never resolve (keep in connecting state)
      const mockFetch = vi.fn().mockImplementation(() => new Promise(() => {}));
      const originalFetch = global.fetch;
      global.fetch = mockFetch;

      function ThreadIdCollector() {
        const { agent } = useAgent({ agentId: "default" });

        // Use ref to track across renders without causing re-renders
        const threadIdsRef = useRef<string[]>([]);

        useEffect(() => {
          if (agent?.threadId && !threadIdsRef.current.includes(agent.threadId)) {
            threadIdsRef.current.push(agent.threadId);
            observedThreadIds.push(agent.threadId);
          }
        }, [agent?.threadId]);

        return <div data-testid="thread-id">{agent?.threadId ?? "none"}</div>;
      }

      const { rerender } = render(
        <CopilotKitProvider runtimeUrl="http://localhost:3000/api/copilotkit">
          <ThreadIdCollector />
        </CopilotKitProvider>
      );

      // Force multiple re-renders to simulate React's behavior
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      rerender(
        <CopilotKitProvider runtimeUrl="http://localhost:3000/api/copilotkit">
          <ThreadIdCollector />
        </CopilotKitProvider>
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      rerender(
        <CopilotKitProvider runtimeUrl="http://localhost:3000/api/copilotkit">
          <ThreadIdCollector />
        </CopilotKitProvider>
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // Restore fetch
      global.fetch = originalFetch;

      const uniqueThreadIds = [...new Set(observedThreadIds)];
      console.log("ThreadIds collected during rerenders:", observedThreadIds);
      console.log("Unique threadIds:", uniqueThreadIds);

      // CRITICAL: Should only have ONE unique threadId across all renders
      // This test will FAIL before the fix because each useMemo re-run creates
      // a new ProxiedCopilotRuntimeAgent with a new UUID
      expect(uniqueThreadIds.length).toBeLessThanOrEqual(1);
    });
  });
});
