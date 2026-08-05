import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  AgentSubscriber,
  BaseEvent,
  RunAgentInput,
  RunAgentParameters,
  RunAgentResult,
} from "@ag-ui/client";
import { EMPTY } from "rxjs";
import type { Observable } from "rxjs";
import { useCopilotAction } from "../use-copilot-action";
import { useCopilotKit } from "../../v2/providers/CopilotKitProvider";
import { CopilotChatToolCallsView } from "../../v2/components/chat/CopilotChatToolCallsView";
import { CopilotKitProvider } from "../../v2/providers/CopilotKitProvider";
import type { AssistantMessage } from "@ag-ui/core";

const toolCallMessage: AssistantMessage = {
  id: "legacy-hitl-assistant",
  role: "assistant",
  content: "",
  toolCalls: [
    {
      id: "legacy-hitl-tool-call",
      type: "function",
      function: {
        name: "legacyApproval",
        arguments: "{}",
      },
    },
  ],
};

class LegacyHITLAgent extends AbstractAgent {
  readonly runInputs: RunAgentInput[] = [];
  private runCount = 0;

  constructor() {
    super({ agentId: "default", threadId: "legacy-hitl-thread" });
  }

  override async runAgent(
    parameters?: RunAgentParameters,
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    const input = this.prepareRunAgentInput(parameters);
    this.runInputs.push(input);

    await subscriber?.onRunStartedEvent?.({
      event: {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      input,
      state: this.state,
      messages: this.messages,
      agent: this,
    });

    const newMessages = this.runCount === 0 ? [toolCallMessage] : [];
    this.runCount += 1;
    this.messages.push(...newMessages);
    return { result: undefined, newMessages };
  }

  override run(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }

  override clone(): this {
    return this;
  }
}

describe("useCopilotAction legacy HITL follow-up", () => {
  it("keeps the generated run ID through renderAndWaitForResponse", async () => {
    const agent = new LegacyHITLAgent();

    function Harness() {
      const { copilotkit } = useCopilotKit();
      const [started, setStarted] = useState(false);

      useCopilotAction({
        name: "legacyApproval",
        description: "Approve the action",
        renderAndWaitForResponse: ({ status, respond }) => {
          if (status === "executing" && respond) {
            return (
              <button onClick={() => void respond({ approved: true })}>
                Approve
              </button>
            );
          }
          return <span data-testid="legacy-hitl-status">{status}</span>;
        },
      });

      return (
        <>
          <button
            onClick={() => {
              setStarted(true);
              void copilotkit.runAgent({ agent });
            }}
          >
            Start
          </button>
          {started && (
            <CopilotChatToolCallsView
              message={toolCallMessage}
              messages={agent.messages}
            />
          )}
        </>
      );
    }

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <Harness />
      </CopilotKitProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(agent.runInputs).toHaveLength(2);
    });
    // The first invocation carries the run id. The follow-up deliberately does
    // NOT repeat it on the wire: pinning it there made the transport treat the
    // follow-up as a resumption of a run it had already finished, re-delivering
    // that run's applied half (duplicating its tool calls) and losing the
    // continuation's own tool call.
    //
    // Logical identity is preserved a layer up — the continuation is registered
    // against the originating id and the state manager re-stamps its events onto
    // it — so this asserts the follow-up happened and left the id to the
    // transport, not that the wire repeats it. StateManager's "re-stamps a
    // continuation onto the run it continues" test covers the identity end.
    expect(agent.runInputs[0].runId).toBeDefined();
    expect(agent.runInputs[1].runId).not.toBe(agent.runInputs[0].runId);
  });
});
