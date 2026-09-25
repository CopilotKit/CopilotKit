import { defineComponent } from "vue";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/vue";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { afterEach, describe, expect, it } from "vitest";

import CopilotChat from "../CopilotChat.vue";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
  textMessageContentEvent,
  textMessageEndEvent,
} from "../../../__tests__/utils/test-helpers";

afterEach(() => cleanup());

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

function subagentStarted(subagentRunId: string, extra: object = {}): BaseEvent {
  return {
    type: EventType.SUBAGENT_STARTED,
    subagentRunId,
    name: `${subagentRunId}-agent`,
    ...extra,
  } as BaseEvent;
}

function subagentFinished(subagentRunId: string, outcome?: object): BaseEvent {
  return {
    type: EventType.SUBAGENT_FINISHED,
    subagentRunId,
    outcome,
  } as BaseEvent;
}

function subagentError(subagentRunId: string, message: string): BaseEvent {
  return {
    type: EventType.SUBAGENT_ERROR,
    subagentRunId,
    message,
  } as BaseEvent;
}

function chat(withCustomSubagent: boolean) {
  return defineComponent({
    components: { CopilotChat },
    setup: () => ({ withCustomSubagent }),
    template: `
      <div style="height: 400px;">
        <CopilotChat :welcome-screen="false">
          <template #tool-call="{ toolCall, status, result }">
            <div :data-testid="'tool-' + toolCall.id">{{ status }}:{{ result ?? "" }}</div>
          </template>
          <template v-if="withCustomSubagent" #subagent="{ subagent, subagentRunId, body }">
            <section data-testid="custom-subagent" :data-subagent-run-id="subagentRunId">
              <h3>{{ subagent?.name }}:{{ subagent?.status }}</h3>
              <component :is="body" />
            </section>
          </template>
        </CopilotChat>
      </div>
    `,
  });
}

async function startChat(options: { customSubagent?: boolean } = {}) {
  const agent = new MockStepwiseAgent();
  renderWithCopilotKit({
    agent,
    children: chat(options.customSubagent ?? false),
  });
  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, "Research this");
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await screen.findByText("Research this");
  const emit = async (...events: BaseEvent[]) => {
    for (const event of events) await agent.emit(event);
  };
  await emit(runStartedEvent());
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
    await emit(
      ...say("supervisor", "Delegating now"),
      ...delegate("call-1", "supervisor"),
      ...delegate("call-2", "supervisor"),
      subagentStarted("research", {
        name: "researcher",
        parentToolCallId: "call-1",
      }),
      subagentStarted("write", { name: "writer", parentToolCallId: "call-2" }),
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
    expect(screen.getAllByText("Found 3 sources")).toHaveLength(1);
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

  it("starts every group collapsed, whatever its status, and keeps a group the user opened open", async () => {
    const emit = await startChat();
    await emit(
      ...say("supervisor", "Delegating now"),
      ...delegate("call-1", "supervisor"),
      ...delegate("call-2", "supervisor"),
      ...delegate("call-3", "supervisor"),
      subagentStarted("done", { parentToolCallId: "call-1" }),
      subagentStarted("failed", { parentToolCallId: "call-2" }),
      subagentStarted("waiting", { parentToolCallId: "call-3" }),
      ...say("d1", "Done text", "done"),
    );
    await waitFor(() =>
      expect(screen.getByText("Done text").closest("[hidden]")).not.toBeNull(),
    );
    expect(header("done").getAttribute("aria-expanded")).toBe("false");

    await fireEvent.click(header("done"));
    expect(header("done").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Done text").closest("[hidden]")).toBeNull();

    await emit(
      subagentFinished("done"),
      subagentError("failed", "Search timed out"),
      subagentFinished("waiting", { type: "suspended" }),
    );

    await waitFor(() => {
      expect(group("done").dataset.status).toBe("done");
      expect(group("failed").dataset.status).toBe("error");
      expect(group("waiting").dataset.status).toBe("suspended");
    });
    expect(header("done").getAttribute("aria-expanded")).toBe("true");
    expect(header("failed").getAttribute("aria-expanded")).toBe("false");
    expect(header("waiting").getAttribute("aria-expanded")).toBe("false");
    expect(within(header("failed")).getByText("Failed")).toBeTruthy();
    expect(within(group("failed")).getByText("Search timed out")).toBeTruthy();
  });

  it("nests a child under its parent group, and groups unannounced output at its position", async () => {
    const emit = await startChat();
    await emit(
      ...say("supervisor", "Delegating now"),
      ...delegate("call-1", "supervisor"),
      subagentStarted("research", { parentToolCallId: "call-1" }),
      subagentStarted("notes", { parentSubagentRunId: "research" }),
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
    await emit(
      ...say("supervisor", "Delegating now"),
      ...delegate("call-1", "supervisor"),
      subagentStarted("research", { parentToolCallId: "call-1" }),
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
    const emit = await startChat({ customSubagent: true });
    await emit(
      ...say("supervisor", "Delegating now"),
      ...delegate("call-1", "supervisor"),
      subagentStarted("research", {
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
    await emit(
      ...say("supervisor", "Plain answer"),
      ...delegate("call-1", "supervisor"),
      runFinishedEvent(),
    );

    await screen.findByText("Plain answer");
    expect(document.querySelector("[data-subagent-run-id]")).toBeNull();
    expect(screen.getByTestId("tool-call-1")).toBeTruthy();
  });
});
