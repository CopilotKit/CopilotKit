import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { Message } from "@ag-ui/core";
import type { Observable } from "rxjs";
import { Subject } from "rxjs";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { useAgent } from "../../../hooks/use-agent";
import { CopilotChat } from "../CopilotChat";
import { CopilotSidebar } from "../CopilotSidebar";

class MockStepwiseAgent extends AbstractAgent {
  private subject = new Subject<BaseEvent>();
  emit(event: BaseEvent) {
    if (event.type === EventType.RUN_STARTED) this.isRunning = true;
    else if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    )
      this.isRunning = false;
    this.subject.next(event);
  }
  clone(): MockStepwiseAgent {
    const cloned = new MockStepwiseAgent();
    cloned.agentId = this.agentId;
    (cloned as unknown as { subject: Subject<BaseEvent> }).subject =
      this.subject;
    return cloned;
  }
  async detachActiveRun(): Promise<void> {}
  run(_input: RunAgentInput): Observable<BaseEvent> {
    return this.subject.asObservable();
  }
}

const hideWorker = (m: Message) =>
  (m as { name?: string }).name !== "math_expert";

// Captures the agent instance CopilotChat actually renders from, so the
// snapshot can reuse its exact message ids and contents.
const probe: { agent: AbstractAgent | null } = { agent: null };
function AgentProbe() {
  const { agent } = useAgent({ agentId: "default" });
  probe.agent = agent;
  return null;
}

async function streamWorkerThenSnapshotName(agent: MockStepwiseAgent) {
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "what is 2+2" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(screen.getByText("what is 2+2")).toBeDefined());

  agent.emit({ type: EventType.RUN_STARTED } as BaseEvent);
  agent.emit({
    type: EventType.TEXT_MESSAGE_START,
    messageId: "w-1",
    role: "assistant",
  } as BaseEvent);
  agent.emit({
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId: "w-1",
    delta: "WORKER_SAYS_FOUR",
  } as BaseEvent);
  agent.emit({
    type: EventType.TEXT_MESSAGE_END,
    messageId: "w-1",
  } as BaseEvent);

  // No name yet: the worker text is visible while it streams (ag-ui #2847).
  await waitFor(() =>
    expect(screen.getByText("WORKER_SAYS_FOUR")).toBeDefined(),
  );

  const named = probe.agent!.messages.map((m) =>
    m.id === "w-1" ? { ...m, name: "math_expert" } : m,
  );
  agent.emit({
    type: EventType.MESSAGES_SNAPSHOT,
    messages: named,
  } as BaseEvent);
}

describe("CopilotChat shouldRenderMessage (end to end)", () => {
  afterEach(() => {
    probe.agent = null;
  });

  it("hides a message when a snapshot adds only its name", async () => {
    const agent = new MockStepwiseAgent();
    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <AgentProbe />
        <div style={{ height: 400 }}>
          <CopilotChat messageView={{ shouldRenderMessage: hideWorker }} />
        </div>
      </CopilotKitProvider>,
    );
    await streamWorkerThenSnapshotName(agent);
    await waitFor(() =>
      expect(screen.queryByText("WORKER_SAYS_FOUR")).toBeNull(),
    );
    expect(screen.getByText("what is 2+2")).toBeDefined();
  });

  it("works through CopilotSidebar's messageView", async () => {
    const agent = new MockStepwiseAgent();
    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <AgentProbe />
        <CopilotSidebar
          defaultOpen
          messageView={{ shouldRenderMessage: hideWorker }}
        />
      </CopilotKitProvider>,
    );
    await streamWorkerThenSnapshotName(agent);
    await waitFor(() =>
      expect(screen.queryByText("WORKER_SAYS_FOUR")).toBeNull(),
    );
  });
});
