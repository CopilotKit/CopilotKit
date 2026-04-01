/**
 * E2E integration test for useAgentContext agentId scoping.
 *
 * Verifies that when multiple useAgentContext hooks register context with
 * different agentIds, each agent only receives the context scoped to it
 * (plus any global context without an agentId).
 *
 * Uses real React rendering in jsdom so that actual useState + useAgentContext
 * lifecycle interactions are exercised.
 */
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { useAgentContext } from "../use-agent-context";
import { CopilotChat } from "@/components/chat/CopilotChat";
import {
  type AgentSubscriber,
  type RunAgentParameters,
} from "@ag-ui/client";
import type { Context } from "@ag-ui/client";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
  runFinishedEvent,
  textMessageStartEvent,
  textMessageContentEvent,
  textMessageEndEvent,
  testId,
} from "@/__tests__/utils/test-helpers";

describe("useAgentContext agentId scoping - E2E", () => {
  it("agent only receives global context and context scoped to its own agentId", async () => {
    class ContextCapturingAgent extends MockStepwiseAgent {
      public contextPerRun: Context[][] = [];

      async runAgent(
        parameters?: RunAgentParameters,
        subscriber?: AgentSubscriber,
      ) {
        this.contextPerRun.push(parameters?.context ?? []);
        return super.runAgent(parameters, subscriber);
      }
    }

    const agent = new ContextCapturingAgent();

    const TestComponent: React.FC = () => {
      // Global context — no agentId
      useAgentContext({
        description: "global info",
        value: "visible to all",
      });

      // Scoped to "default" — the agent being used
      useAgentContext({
        description: "default agent info",
        value: "for default only",
        agentId: "default",
      });

      // Scoped to a different agent — should NOT appear
      useAgentContext({
        description: "other agent info",
        value: "for other only",
        agentId: "other-agent",
      });

      return null;
    };

    renderWithCopilotKit({
      agent,
      children: (
        <>
          <TestComponent />
          <div style={{ height: 400 }}>
            <CopilotChat welcomeScreen={false} />
          </div>
        </>
      ),
    });

    // Submit a message to trigger an agent run
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    // Wait for the agent run
    await waitFor(() => {
      expect(agent.contextPerRun.length).toBeGreaterThanOrEqual(1);
    });

    // Complete the run
    const msgId = testId("msg");
    agent.emit(runStartedEvent());
    agent.emit(textMessageStartEvent(msgId));
    agent.emit(textMessageContentEvent(msgId, "Done"));
    agent.emit(textMessageEndEvent(msgId));
    agent.emit(runFinishedEvent());
    agent.complete();

    // Verify context received by the agent
    const receivedContext = agent.contextPerRun[0];

    // Should contain global context
    expect(receivedContext).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: "global info",
          value: "visible to all",
        }),
      ]),
    );

    // Should contain context scoped to "default"
    expect(receivedContext).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: "default agent info",
          value: "for default only",
        }),
      ]),
    );

    // Should NOT contain context scoped to "other-agent"
    expect(receivedContext).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: "other agent info",
        }),
      ]),
    );

    // Exactly 2 context entries: global + default-scoped
    expect(receivedContext).toHaveLength(2);
  });
});
