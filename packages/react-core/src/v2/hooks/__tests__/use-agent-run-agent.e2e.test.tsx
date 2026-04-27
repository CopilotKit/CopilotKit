/**
 * Tests that agent.runAgent() from useAgent() includes frontend tools.
 *
 * useAgent() installs a CopilotKit middleware (via agent.use()) that injects
 * registered frontend tools, context, and forwarded properties into the
 * RunAgentInput when they are not already present. This ensures tools
 * registered via useFrontendTool, useHumanInTheLoop, etc. are always
 * included — even when calling agent.runAgent() directly without going
 * through copilotkit.runAgent().
 */
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { type RunAgentInput } from "@ag-ui/client";
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
        // the middleware should inject frontend tools into RunAgentInput
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
