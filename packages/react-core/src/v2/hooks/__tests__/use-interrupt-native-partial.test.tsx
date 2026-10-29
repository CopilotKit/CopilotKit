import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { CopilotKitCoreReact } from "../../lib/react-core";
import { of } from "rxjs";
import { useInterrupt } from "../use-interrupt";
import { useAgent } from "../use-agent";
import { useCopilotKit } from "../../context";
vi.mock("../use-agent", () => ({ useAgent: vi.fn() }));
vi.mock("../../context", () => ({ useCopilotKit: vi.fn() }));
class NativeAgent extends AbstractAgent {
  inputs: RunAgentInput[] = [];
  run(input: RunAgentInput) {
    this.inputs.push(input);
    const events: BaseEvent[] = [
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [
          {
            id: "calls",
            role: "assistant",
            toolCalls: ["one", "two"].map((id) => ({
              id,
              type: "function",
              function: { name: "protected", arguments: "{}" },
            })),
          },
        ],
      },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
        outcome: {
          type: "interrupt",
          interrupts: ["one", "two"]
            .filter((id) => !input.resume?.some((r) => r.interruptId === id))
            .map((id) => ({
              id,
              toolCallId: id,
              reason: "tool_call",
              metadata: { "ag-ui:tool-execution": "server" },
            })),
        },
      },
    ];
    return of(...events);
  }
}
function Harness() {
  return useInterrupt({
    renderInChat: false,
    render: ({ interrupts, resolve }) => (
      <button onClick={() => resolve({ approved: true }, "one")}>
        {interrupts.length} pending
      </button>
    ),
  });
}
describe("native partial choice hook", () => {
  it("persists the first choice before the second is answered, without synthetic results", async () => {
    const agent = new NativeAgent({
      agentId: "test",
      allowPartialNativeApprovals: true,
    });
    const core = new CopilotKitCoreReact({});
    core.addAgent__unsafe_dev_only({ id: "test", agent });
    vi.mocked(useAgent).mockReturnValue({ agent, isReady: true });
    vi.mocked(useCopilotKit).mockReturnValue({
      copilotkit: core,
      executingToolCallIds: new Set(),
    });
    await core.runAgent({ agent });
    render(<Harness />);
    await act(async () => screen.getByText("2 pending").click());
    await waitFor(() => expect(screen.getByText("1 pending")).toBeTruthy());
    expect(agent.inputs[1]?.resume).toEqual([
      { interruptId: "one", status: "resolved", payload: { approved: true } },
    ]);
    expect(agent.inputs[1]?.messages).toEqual([]);
    expect(agent.messages.some((m) => m.role === "tool")).toBe(false);
  });
});
