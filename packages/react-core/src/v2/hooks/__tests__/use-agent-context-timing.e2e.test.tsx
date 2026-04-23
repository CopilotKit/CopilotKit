/**
 * Integration test for the context timing race condition (CPK-7060).
 *
 * When a useFrontendTool handler calls setState(), the corresponding
 * useAgentContext value is updated asynchronously (React defers useEffect to a
 * later scheduler task). Without yielding before the follow-up agent run,
 * runAgent reads stale context from the store.
 *
 * CopilotKitCoreReact.waitForPendingFrameworkUpdates() fixes this by awaiting a
 * zero-delay timeout, which yields to React's scheduler before reading context.
 *
 * This test uses real React rendering in jsdom so that actual useState +
 * useAgentContext + useFrontendTool lifecycle interactions are exercised.
 */
import React, { useState } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { z } from "zod";
import { useFrontendTool } from "../use-frontend-tool";
import { useAgentContext } from "../use-agent-context";
import { CopilotChat } from "../../components/chat/CopilotChat";
import {
  type AgentSubscriber,
  type BaseEvent,
  type RunAgentParameters,
} from "@ag-ui/client";
import type { Context } from "@ag-ui/client";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
  runFinishedEvent,
  toolCallChunkEvent,
  testId,
} from "../../__tests__/utils/test-helpers";

describe("useAgentContext timing - follow-up run sees updated context", () => {
  it("follow-up agent run receives context updated by useFrontendTool handler", async () => {
    /**
     * Agent subclass that records the context parameter on every runAgent call.
     * After complete() is called on the subject the Observable completes
     * immediately for subsequent subscriptions, so the follow-up run resolves
     * with no new messages — which is fine; we only need to capture context.
     */
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

    /**
     * Component that wires React state into useAgentContext and exposes a
     * frontend tool that updates that state.
     */
    const TestComponent: React.FC = () => {
      const [prefs, setPrefs] = useState<{ spicy: boolean }>({ spicy: true });

      useAgentContext({
        description: "user preferences",
        value: prefs,
      });

      useFrontendTool({
        name: "updatePrefs",
        parameters: z.object({}),
        followUp: true,
        handler: async () => {
          setPrefs({ spicy: false });
        },
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

    // Submit a user message to start the first agent run
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Update my preferences" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    // Wait for the first runAgent call to arrive
    await waitFor(() => {
      expect(agent.contextPerRun.length).toBeGreaterThanOrEqual(1);
    });

    // First run: the agent calls the updatePrefs tool
    const messageId = testId("msg");
    const toolCallId = testId("tc");

    agent.emit(runStartedEvent());
    agent.emit(
      toolCallChunkEvent({
        toolCallId,
        toolCallName: "updatePrefs",
        parentMessageId: messageId,
        delta: "{}",
      }),
    );
    agent.emit(runFinishedEvent());
    agent.complete();

    // Wait for the follow-up run to be triggered by processAgentResult
    await waitFor(() => {
      expect(agent.contextPerRun.length).toBeGreaterThanOrEqual(2);
    });

    // The follow-up run should see the context updated by the tool handler
    // (spicy: false), not the stale value from before the handler ran (spicy: true).
    const followUpContext = agent.contextPerRun[1];
    expect(followUpContext).toContainEqual(
      expect.objectContaining({ value: '{"spicy":false}' }),
    );
  });
});
