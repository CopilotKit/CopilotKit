import React from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import { CopilotChat } from "../CopilotChat";
import type { CopilotChatSubagentProps } from "../CopilotChatSubagent";
import type { ReactToolCallRenderer } from "../../../types";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
  subagentErrorEvent,
  subagentFinishedEvent,
  subagentStartedEvent,
  textMessageContentEvent,
  textMessageEndEvent,
} from "../../../__tests__/utils/test-helpers";

function textStart(messageId: string, subagentRunId?: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_START,
    messageId,
    role: "assistant",
    subagentRunId,
  } as BaseEvent;
}

/** A whole assistant text message, optionally attributed to a subagent. */
function say(messageId: string, text: string, subagentRunId?: string) {
  return [
    textStart(messageId, subagentRunId),
    textMessageContentEvent(messageId, text),
    textMessageEndEvent(messageId),
  ];
}

/** A supervisor tool call that delegates to a subagent. */
function delegate(toolCallId: string, parentMessageId: string): BaseEvent[] {
  return [
    {
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName: "delegate",
      parentMessageId,
    },
    { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: "{}" },
    { type: EventType.TOOL_CALL_END, toolCallId },
  ] as BaseEvent[];
}

/** Shows each tool call's status and result, so tests can see the parent card. */
const toolCard = {
  name: "*",
  render: ({
    toolCallId,
    status,
    result,
  }: {
    toolCallId: string;
    status: string;
    result?: string;
  }) => (
    <div data-testid={`tool-${toolCallId}`}>{`${status}:${result ?? ""}`}</div>
  ),
} as unknown as ReactToolCallRenderer<unknown>;

async function startChat(options: { children?: React.ReactNode } = {}) {
  const agent = new MockStepwiseAgent();
  renderWithCopilotKit({
    agent,
    renderToolCalls: [toolCard],
    children: options.children,
  });
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "Research this" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await screen.findByText("Research this");
  const emit = (...events: BaseEvent[]) => {
    for (const event of events) agent.emit(event);
  };
  emit(runStartedEvent());
  return emit;
}

function group(subagentRunId: string) {
  const element = document.querySelector(
    `[data-subagent-run-id="${subagentRunId}"]`,
  );
  if (!(element instanceof HTMLElement)) {
    throw new Error(`no group for ${subagentRunId}`);
  }
  return element;
}

function header(subagentRunId: string) {
  return within(group(subagentRunId)).getAllByRole("button")[0]!;
}

describe("CopilotChat subagent groups", () => {
  it("puts two parallel subagents right after the tool calls that started them", async () => {
    const emit = await startChat();
    emit(
      ...say("supervisor", "Delegating now"),
      ...delegate("call-1", "supervisor"),
      ...delegate("call-2", "supervisor"),
      subagentStartedEvent("research", {
        name: "researcher",
        parentToolCallId: "call-1",
      }),
      subagentStartedEvent("write", {
        name: "writer",
        parentToolCallId: "call-2",
      }),
      textStart("r1", "research"),
      ...say("w1", "Drafting intro", "write"),
      textMessageContentEvent("r1", "Found 3 "),
      textMessageContentEvent("r1", "sources"),
      textMessageEndEvent("r1"),
    );

    await waitFor(() =>
      expect(
        within(group("research")).getByText("Found 3 sources"),
      ).toBeTruthy(),
    );
    expect(within(group("write")).getByText("Drafting intro")).toBeTruthy();
    expect(within(group("research")).queryByText("Drafting intro")).toBeNull();
    // Each subagent's text shows once, inside its group only.
    expect(screen.getAllByText("Found 3 sources")).toHaveLength(1);
    // The group follows its tool card, and the second call's card follows the first group.
    const card1 = screen.getByTestId("tool-call-1");
    const card2 = screen.getByTestId("tool-call-2");
    expect(
      card1.compareDocumentPosition(group("research")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      group("research").compareDocumentPosition(card2) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(group("research")).getByText("researcher")).toBeTruthy();
  });

  it("collapses a finished group, keeps failed and waiting groups open, and lets the user toggle", async () => {
    const emit = await startChat();
    emit(
      ...say("supervisor", "Delegating now"),
      ...delegate("call-1", "supervisor"),
      ...delegate("call-2", "supervisor"),
      ...delegate("call-3", "supervisor"),
      subagentStartedEvent("done", { parentToolCallId: "call-1" }),
      subagentStartedEvent("failed", { parentToolCallId: "call-2" }),
      subagentStartedEvent("waiting", { parentToolCallId: "call-3" }),
      ...say("d1", "Done text", "done"),
    );
    await waitFor(() =>
      expect(header("done").getAttribute("aria-expanded")).toBe("true"),
    );

    emit(
      subagentFinishedEvent("done"),
      subagentErrorEvent("failed", "Search timed out"),
      subagentFinishedEvent("waiting", { type: "suspended" }),
    );

    await waitFor(() => {
      expect(group("done").dataset.status).toBe("done");
      expect(group("failed").dataset.status).toBe("error");
      expect(group("waiting").dataset.status).toBe("suspended");
    });
    expect(header("done").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Done text").closest("[hidden]")).not.toBeNull();
    expect(header("failed").getAttribute("aria-expanded")).toBe("true");
    expect(within(group("failed")).getByText("Search timed out")).toBeTruthy();
    expect(header("waiting").getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(header("done"));
    expect(header("done").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Done text").closest("[hidden]")).toBeNull();
  });

  it("nests a child under its parent group, and groups unannounced output at its position", async () => {
    const emit = await startChat();
    emit(
      ...say("supervisor", "Delegating now"),
      ...delegate("call-1", "supervisor"),
      subagentStartedEvent("research", { parentToolCallId: "call-1" }),
      subagentStartedEvent("notes", { parentSubagentRunId: "research" }),
      ...say("n1", "Taking notes", "notes"),
      ...say("x1", "Mystery work", "unannounced"),
    );

    await waitFor(() =>
      expect(within(group("notes")).getByText("Taking notes")).toBeTruthy(),
    );
    expect(group("research").contains(group("notes"))).toBe(true);
    expect(within(group("unannounced")).getByText("Subagent")).toBeTruthy();
    expect(within(group("unannounced")).getByText("Mystery work")).toBeTruthy();
  });

  it("pairs a tool result attributed to a subagent with the parent's tool card", async () => {
    const emit = await startChat();
    emit(
      ...say("supervisor", "Delegating now"),
      ...delegate("call-1", "supervisor"),
      subagentStartedEvent("research", { parentToolCallId: "call-1" }),
      {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "call-1",
        messageId: "result-1",
        role: "tool",
        content: "3 sources",
        subagentRunId: "research",
      } as BaseEvent,
    );

    await waitFor(() =>
      expect(screen.getByTestId("tool-call-1").textContent).toBe(
        "complete:3 sources",
      ),
    );
  });

  it("renders a custom subagent slot with the group's messages inside", async () => {
    function Custom({
      subagent,
      subagentRunId,
      children,
    }: CopilotChatSubagentProps) {
      return (
        <section
          data-testid="custom-subagent"
          data-subagent-run-id={subagentRunId}
        >
          <h3>{`${subagent?.name}:${subagent?.status}`}</h3>
          {children}
        </section>
      );
    }
    const emit = await startChat({
      children: (
        <div style={{ height: 400 }}>
          <CopilotChat
            welcomeScreen={false}
            messageView={{ subagent: Custom }}
          />
        </div>
      ),
    });
    emit(
      ...say("supervisor", "Delegating now"),
      ...delegate("call-1", "supervisor"),
      subagentStartedEvent("research", {
        name: "researcher",
        parentToolCallId: "call-1",
      }),
      ...say("r1", "Found sources", "research"),
    );

    const custom = await screen.findByTestId("custom-subagent");
    expect(within(custom).getByText("researcher:running")).toBeTruthy();
    await waitFor(() =>
      expect(within(custom).getByText("Found sources")).toBeTruthy(),
    );
  });

  it("renders an unattributed run exactly as before, with no groups", async () => {
    const emit = await startChat();
    emit(
      ...say("supervisor", "Plain answer"),
      ...delegate("call-1", "supervisor"),
      runFinishedEvent(),
    );

    await screen.findByText("Plain answer");
    expect(document.querySelector("[data-subagent-run-id]")).toBeNull();
    expect(screen.getByTestId("tool-call-1")).toBeTruthy();
  });
});
