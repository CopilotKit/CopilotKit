import React from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useHumanInTheLoop } from "../use-human-in-the-loop";
import type { ActionRenderPropsWait } from "../../types/frontend-action";
import { CopilotChat } from "../../../v2/components/chat/CopilotChat";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
  testId,
  toolCallChunkEvent,
} from "../../../v2/__tests__/utils/test-helpers";

type HitlParameters = [{ name: "action"; type: "string" }];
const parameters: HitlParameters = [{ name: "action", type: "string" }];
type RenderProps = ActionRenderPropsWait<HitlParameters>;

/**
 * Registers a v1 HITL tool that records every render and offers an Approve
 * button while the call waits on the user.
 */
function renderV1Hitl(agent: MockStepwiseAgent, name: string) {
  const rendered: RenderProps[] = [];

  const Hitl: React.FC = () => {
    useHumanInTheLoop({
      name,
      description: "Requires human approval",
      parameters,
      render: (props) => {
        rendered.push(props);
        return (
          <div>
            <div data-testid="v1-hitl-status">{props.status}</div>
            {props.status === "executing" && (
              <button
                data-testid="v1-hitl-approve"
                onClick={() => props.respond("approved")}
              >
                Approve
              </button>
            )}
          </div>
        );
      },
    });
    return null;
  };

  renderWithCopilotKit({
    agent,
    children: (
      <>
        <Hitl />
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      </>
    ),
  });

  return rendered;
}

/** Sends a message and drives the agent until the HITL call is executing. */
async function startHitlCall(agent: MockStepwiseAgent, name: string) {
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "Request approval" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => {
    expect(screen.getByText("Request approval")).toBeDefined();
  });

  agent.emit(runStartedEvent());
  agent.emit(
    toolCallChunkEvent({
      toolCallId: testId("tc"),
      toolCallName: name,
      parentMessageId: testId("msg"),
      delta: JSON.stringify({ action: "delete" }),
    }),
  );
  agent.emit(runFinishedEvent());
  agent.complete();

  await waitFor(() => {
    expect(screen.getByTestId("v1-hitl-status").textContent).toBe("executing");
  });
}

const lastComplete = (rendered: RenderProps[]) => {
  const complete = rendered.filter((p) => p.status === "complete");
  expect(complete.length).toBeGreaterThan(0);
  return complete[complete.length - 1];
};

describe("v1 useHumanInTheLoop stop while waiting", () => {
  it("renders a stopped request as aborted with no result", async () => {
    const agent = new MockStepwiseAgent();
    const rendered = renderV1Hitl(agent, "v1AbortTool");
    await startHitlCall(agent, "v1AbortTool");

    act(() => {
      agent.abortRun();
    });

    await waitFor(() => {
      const last = lastComplete(rendered);
      expect(last.aborted).toBe(true);
      expect(last.result).toBeUndefined();
      expect(last.error).toBe("Human-in-the-loop interaction aborted");
    });
  });

  it("renders an answered request with its answer and no aborted flag", async () => {
    const agent = new MockStepwiseAgent();
    const rendered = renderV1Hitl(agent, "v1RespondTool");
    await startHitlCall(agent, "v1RespondTool");

    fireEvent.click(screen.getByTestId("v1-hitl-approve"));

    await waitFor(() => {
      const last = lastComplete(rendered);
      expect(last.result).toBe("approved");
      expect(last.aborted).toBeUndefined();
    });
  });
});
