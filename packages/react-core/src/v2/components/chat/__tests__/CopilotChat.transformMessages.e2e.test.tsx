import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, AbstractAgent } from "@ag-ui/client";
import type { Message } from "@ag-ui/core";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { useAgent } from "../../../hooks/use-agent";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";
import { CopilotChat } from "../CopilotChat";
import { CopilotSidebar } from "../CopilotSidebar";

/**
 * `transformMessages` is memoized on `agent.messages` through CopilotChat's
 * `messagesMemoKey` fingerprint (see CopilotChat.tsx). A MESSAGES_SNAPSHOT
 * that only adds a `name` to an existing message must still produce a new
 * fingerprint, or the memoized array never changes reference and the
 * transform never sees the new name.
 */

const isWorkerMessage = (m: Message) =>
  (m as { name?: string }).name === "math_expert";
const hideWorker = (list: Message[]): Message[] =>
  list.filter((m) => !isWorkerMessage(m));

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

describe("CopilotChat transformMessages (end to end)", () => {
  afterEach(() => {
    probe.agent = null;
  });

  it("hides a message when a snapshot adds only its name", async () => {
    const agent = new MockStepwiseAgent();
    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <AgentProbe />
        <div style={{ height: 400 }}>
          <CopilotChat messageView={{ transformMessages: hideWorker }} />
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
          messageView={{ transformMessages: hideWorker }}
        />
      </CopilotKitProvider>,
    );
    await streamWorkerThenSnapshotName(agent);
    await waitFor(() =>
      expect(screen.queryByText("WORKER_SAYS_FOUR")).toBeNull(),
    );
  });

  it("toggles rows when the transform passed through messageView changes", async () => {
    const agent = new MockStepwiseAgent();
    const showAll = (list: Message[]): Message[] => list;
    const tree = (transformMessages: (list: Message[]) => Message[]) => (
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <AgentProbe />
        <div style={{ height: 400 }}>
          <CopilotChat messageView={{ transformMessages }} />
        </div>
      </CopilotKitProvider>
    );
    const { rerender } = render(tree(showAll));
    await streamWorkerThenSnapshotName(agent);
    agent.emit({ type: EventType.RUN_FINISHED } as BaseEvent);

    // The transcript is finished and holds a math_expert message. showAll
    // keeps it on screen.
    await waitFor(() =>
      expect(
        probe.agent!.messages.some(
          (m) => (m as { name?: string }).name === "math_expert",
        ),
      ).toBe(true),
    );
    expect(screen.getByText("WORKER_SAYS_FOUR")).toBeDefined();

    rerender(tree(hideWorker));
    await waitFor(() =>
      expect(screen.queryByText("WORKER_SAYS_FOUR")).toBeNull(),
    );
    expect(screen.getByText("what is 2+2")).toBeDefined();

    rerender(tree(showAll));
    await waitFor(() =>
      expect(screen.getByText("WORKER_SAYS_FOUR")).toBeDefined(),
    );
  });
});
