import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { type BaseEvent, type RunAgentInput } from "@ag-ui/client";
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
import { CopilotChat } from "@/components/chat/CopilotChat";

/**
 * Mock agent that captures RunAgentInput to verify state is passed correctly
 */
class StateCapturingMockAgent extends MockStepwiseAgent {
  public lastRunInput?: RunAgentInput;

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.lastRunInput = input;
    return super.run(input);
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
});
