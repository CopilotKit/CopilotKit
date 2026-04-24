/**
 * Tests that agent.runAgent() from useAgent() includes frontend tools.
 *
 * useAgent() returns a proxied agent whose runAgent() delegates to
 * copilotkit.runAgent({ agent }), which collects all registered frontend
 * tools and context before sending the request. This ensures tools
 * registered via useFrontendTool, useHumanInTheLoop, etc. are always
 * included — without requiring the caller to know about copilotkit.runAgent.
 */
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  type RunAgentInput,
  type AgentSubscriber,
  type RunAgentParameters,
} from "@ag-ui/client";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
  runFinishedEvent,
  testId,
} from "../../__tests__/utils/test-helpers";
import { useAgent } from "../use-agent";
import { useFrontendTool } from "../use-frontend-tool";

/**
 * Mock agent that captures RunAgentInput to verify tools are passed.
 */
class ToolCapturingMockAgent extends MockStepwiseAgent {
  private _capture: { lastRunInput?: RunAgentInput } = {};

  get lastRunInput(): RunAgentInput | undefined {
    return this._capture.lastRunInput;
  }

  clone(): this {
    const cloned = super.clone();
    (cloned as unknown as ToolCapturingMockAgent)._capture = this._capture;
    return cloned;
  }

  async runAgent(
    parameters?: RunAgentParameters,
    subscriber?: AgentSubscriber,
  ) {
    return super.runAgent(parameters, subscriber);
  }

  run(input: RunAgentInput) {
    this._capture.lastRunInput = input;
    return super.run(input);
  }
}

describe("useAgent().agent.runAgent()", () => {
  it("includes frontend tools registered via useFrontendTool", async () => {
    const agent = new ToolCapturingMockAgent();

    function TestComponent() {
      const { agent: hookAgent } = useAgent();

      useFrontendTool({
        name: "myTool",
        description: "A test frontend tool",
        parameters: z.object({
          input: z.string().describe("Test input"),
        }),
        handler: async () => "done",
      });

      const handleClick = async () => {
        hookAgent.addMessage({
          id: testId("user-msg"),
          role: "user",
          content: "Use my tool",
        });
        // Call runAgent() directly on the agent from useAgent() —
        // the proxy should route this through copilotkit.runAgent()
        await hookAgent.runAgent();
      };

      return (
        <button data-testid="run-btn" onClick={handleClick}>
          Run
        </button>
      );
    }

    renderWithCopilotKit({
      agent,
      children: <TestComponent />,
    });

    const btn = await screen.findByTestId("run-btn");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(agent.lastRunInput).toBeDefined();
    });

    // Verify the frontend tool is included in the request
    const toolNames = agent.lastRunInput!.tools?.map((t) => t.name) ?? [];
    expect(toolNames).toContain("myTool");

    // Complete the run to avoid dangling subscriptions
    agent.emit(runStartedEvent());
    agent.emit(runFinishedEvent());
    agent.complete();
  });
});
