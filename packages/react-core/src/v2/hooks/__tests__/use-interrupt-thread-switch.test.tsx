import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput, RunFinishedEvent } from "@ag-ui/client";
import { from } from "rxjs";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../providers/CopilotChatConfigurationProvider";
import { CopilotChat } from "../../components/chat/CopilotChat";
import { useInterrupt } from "../use-interrupt";
import type {
  InterruptResolveFn,
  InterruptCancelFn,
} from "../../types/interrupt";

class ApprovalAgent extends AbstractAgent {
  replaysPending = true;
  readonly connects: string[] = [];
  readonly runs: RunAgentInput[] = [];
  readonly connectInputs: RunAgentInput[] = [];

  private events(input: RunAgentInput, pending: boolean) {
    return from<BaseEvent[]>([
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
        ...(pending
          ? {
              outcome: {
                type: "interrupt",
                interrupts: [
                  {
                    id: "approval",
                    reason: "confirmation",
                    message: "Approve saved action?",
                  },
                ],
              },
            }
          : {}),
      },
    ]);
  }

  connect(input: RunAgentInput) {
    this.connects.push(input.threadId);
    this.connectInputs.push(input);
    return this.events(
      input,
      this.replaysPending && input.threadId === "pending",
    );
  }

  // A custom adapter may finish delivery after the view has detached. Deliver
  // through the real subscriber list with the original captured run input.
  async deliverLateInterrupt(input: RunAgentInput) {
    const interrupts = [{ id: "late-approval", reason: "confirmation" }];
    const event: RunFinishedEvent = {
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
      outcome: { type: "interrupt", interrupts },
    };
    const params = {
      input,
      agent: this,
      state: this.state,
      messages: this.messages,
    };
    for (const subscriber of this.subscribers) {
      await subscriber.onRunFinishedEvent?.({
        ...params,
        event,
        outcome: "interrupt",
        interrupts,
      });
      await subscriber.onRunFinalized?.(params);
    }
  }

  run(input: RunAgentInput) {
    this.runs.push(input);
    return this.events(input, false);
  }
}

type Controls = { resolve: InterruptResolveFn; cancel: InterruptCancelFn };

function ApprovalControl({
  inChat,
  onControls,
}: {
  inChat: boolean;
  onControls?: (controls: Controls) => void;
}) {
  const element = useInterrupt({
    renderInChat: inChat,
    render: ({ interrupt, resolve, cancel }) => {
      onControls?.({ resolve, cancel });
      return (
        <div data-testid="external-approval">
          <span>{interrupt?.message}</span>
          <button onClick={() => resolve({ approved: true })}>
            Native approve
          </button>
          <button onClick={() => cancel()}>Native decline</button>
        </div>
      );
    },
  });
  return element ?? null;
}

describe("useInterrupt conversation lifecycle", () => {
  it("clears the old approval when selecting a different registered agent", async () => {
    const original = new ApprovalAgent({ agentId: "original" });
    const replacement = new ApprovalAgent({ agentId: "replacement" });
    replacement.replaysPending = false;
    const agents = { original, replacement };
    const view = (agentId: string) => (
      <CopilotKitProvider agents__unsafe_dev_only={agents}>
        <CopilotChatConfigurationProvider agentId={agentId} threadId="pending">
          <ApprovalControl inChat={false} />
          <CopilotChat welcomeScreen={false} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );
    const { rerender } = render(view("original"));
    await screen.findByTestId("external-approval");
    rerender(view("replacement"));
    await waitFor(() => expect(replacement.connects).toEqual(["pending"]));
    await waitFor(() =>
      expect(screen.queryByTestId("external-approval")).toBeNull(),
    );
    expect(original.runs).toEqual([]);
    expect(replacement.runs).toEqual([]);
  });

  it.each([
    { decision: "approve", inChat: false },
    { decision: "decline", inChat: false },
    { decision: "approve", inChat: true },
    { decision: "decline", inChat: true },
  ])(
    "clears controls on New Conversation and completed replay, then can $decision a reopened pending thread (inChat=$inChat)",
    async ({ decision, inChat }) => {
      const agent = new ApprovalAgent({ agentId: "default" });
      const agents = { default: agent };
      const controls: Controls[] = [];
      const view = (threadId: string, explicit = true) => (
        <CopilotKitProvider agents__unsafe_dev_only={agents}>
          <CopilotChatConfigurationProvider
            threadId={threadId}
            hasExplicitThreadId={explicit}
          >
            <ApprovalControl
              inChat={inChat}
              onControls={(next) => controls.push(next)}
            />
            <CopilotChat welcomeScreen={false} />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      );
      const { rerender } = render(view("pending"));
      await screen.findByTestId("external-approval");
      const staleControls = controls.at(-1)!;
      rerender(view("pending"));
      expect(screen.queryByTestId("external-approval")).not.toBeNull();

      rerender(view("new", false));
      await waitFor(() =>
        expect(screen.queryByTestId("external-approval")).toBeNull(),
      );
      expect(agent.pendingInterrupts).toEqual([]);
      expect(agent.connects).toEqual(["pending"]);
      expect(agent.runs).toEqual([]);
      await act(async () => agent.deliverLateInterrupt(agent.connectInputs[0]));
      expect(screen.queryByTestId("external-approval")).toBeNull();

      rerender(view("pending"));
      await screen.findByTestId("external-approval");
      rerender(view("completed"));
      await waitFor(() => expect(agent.connects.at(-1)).toBe("completed"));
      await waitFor(() =>
        expect(screen.queryByTestId("external-approval")).toBeNull(),
      );
      expect(agent.runs).toEqual([]);

      rerender(view("pending"));
      await screen.findByTestId("external-approval");
      await act(async () => {
        await staleControls.resolve({ approved: true });
        await staleControls.cancel();
      });
      expect(agent.runs).toEqual([]);
      expect(screen.queryByTestId("external-approval")).not.toBeNull();
      await act(async () =>
        fireEvent.click(screen.getByText(`Native ${decision}`)),
      );
      await waitFor(() => expect(agent.runs).toHaveLength(1));
      expect(agent.runs[0].threadId).toBe("pending");
      expect(agent.runs[0].resume).toEqual([
        decision === "approve"
          ? {
              interruptId: "approval",
              status: "resolved",
              payload: { approved: true },
            }
          : { interruptId: "approval", status: "cancelled" },
      ]);
      await waitFor(() =>
        expect(screen.queryByTestId("external-approval")).toBeNull(),
      );
    },
  );
});
