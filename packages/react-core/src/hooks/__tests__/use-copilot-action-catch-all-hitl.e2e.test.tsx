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
import type { CatchAllActionRenderPropsWait } from "../../types/frontend-action";
import { useCopilotKit } from "../../v2/providers/CopilotKitProvider";
import { CopilotChatToolCallsView } from "../../v2/components/chat/CopilotChatToolCallsView";
import { CopilotKitProvider } from "../../v2/providers/CopilotKitProvider";
import type { AssistantMessage } from "@ag-ui/core";

/**
 * A tool call for which no dedicated action is registered — only a catch-all.
 */
const toolCallMessage: AssistantMessage = {
  id: "catch-all-hitl-assistant",
  role: "assistant",
  content: "",
  toolCalls: [
    {
      id: "catch-all-hitl-tool-call",
      type: "function",
      function: {
        name: "book_call",
        arguments: JSON.stringify({ topic: "Intro with sales" }),
      },
    },
  ],
};

class CatchAllHITLAgent extends AbstractAgent {
  readonly runInputs: RunAgentInput[] = [];
  private runCount = 0;

  constructor() {
    super({ agentId: "default", threadId: "catch-all-hitl-thread" });
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

/**
 * Issue #1746: a catch-all action could only ever render. `getActionConfig`
 * short-circuited on `name === "*"` before it looked for a wait-render, so
 * `renderAndWaitForResponse` was silently downgraded to a render-only action
 * with no `respond` — one hook could not serve N human-in-the-loop tools.
 */
describe("useCopilotAction catch-all HITL (#1746)", () => {
  function renderHarness(agent: CatchAllHITLAgent, onNames: string[]) {
    function Harness() {
      const { copilotkit } = useCopilotKit();
      const [started, setStarted] = useState(false);

      useCopilotAction({
        name: "*",
        // Props are annotated because `useCopilotAction`'s parameter is a union
        // and TypeScript cannot contextually type a catch-all render from it —
        // pre-existing for `render` too, not specific to the wait variant.
        renderAndWaitForResponse: ({
          name,
          args,
          status,
          respond,
        }: CatchAllActionRenderPropsWait<any>) => {
          onNames.push(name);
          if (status === "executing" && respond) {
            return (
              <div>
                <span data-testid="catch-all-name">{name}</span>
                <span data-testid="catch-all-topic">
                  {(args as { topic?: string })?.topic}
                </span>
                <button onClick={() => void respond({ slot: "tuesday" })}>
                  Pick Tuesday
                </button>
              </div>
            );
          }
          return (
            <span data-testid="catch-all-status">
              {name}:{status}
            </span>
          );
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

    return render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <Harness />
      </CopilotKitProvider>,
    );
  }

  it("gives the catch-all render a live respond and the real tool name", async () => {
    const agent = new CatchAllHITLAgent();
    const seenNames: string[] = [];
    renderHarness(agent, seenNames);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Pick Tuesday" }),
      ).toBeDefined();
    });

    // The render must see the tool actually being called, not the "*" it
    // registered under — otherwise one catch-all cannot tell N tools apart.
    expect(screen.getByTestId("catch-all-name").textContent).toBe("book_call");
    expect(seenNames).not.toContain("*");
    // Args reach the catch-all render unwrapped.
    expect(screen.getByTestId("catch-all-topic").textContent).toBe(
      "Intro with sales",
    );

    fireEvent.click(screen.getByRole("button", { name: "Pick Tuesday" }));

    // respond() resolves the pending call: a tool result is recorded against
    // the original toolCallId, and the follow-up run happens.
    await waitFor(() => {
      expect(agent.runInputs).toHaveLength(2);
    });

    const toolResult = agent.messages.find(
      (m) => m.role === "tool" && m.toolCallId === "catch-all-hitl-tool-call",
    );
    expect(toolResult).toBeDefined();
    expect((toolResult as { content?: string }).content).toContain("tuesday");
  });

  it("never advertises the wildcard tool to the agent", async () => {
    const agent = new CatchAllHITLAgent();
    renderHarness(agent, []);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(agent.runInputs).toHaveLength(1);
    });

    expect(agent.runInputs[0].tools.map((t) => t.name)).not.toContain("*");
  });
});
