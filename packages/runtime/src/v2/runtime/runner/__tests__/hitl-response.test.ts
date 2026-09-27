import { describe, expect, it } from "vitest";
import type { Message, RunAgentInput } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import {
  HITL_RESPONSE_EVENT_NAME,
  buildHitlResponseEvents,
  isReservedCustomEvent,
} from "../hitl-response";

const hitlTool = {
  name: "approve_refund",
  description: "Ask the user to approve a refund",
  parameters: { type: "object", properties: {} },
  metadata: { copilotkit: { interaction: "human-in-the-loop" } },
};
const plainTool = {
  name: "show_chart",
  description: "Render a chart",
  parameters: { type: "object", properties: {} },
};

const assistant: Message = {
  id: "a-1",
  role: "assistant",
  content: "",
  toolCalls: [
    {
      id: "tc-hitl",
      type: "function",
      function: { name: "approve_refund", arguments: "{}" },
    },
    {
      id: "tc-plain",
      type: "function",
      function: { name: "show_chart", arguments: "{}" },
    },
  ],
};
const hitlResult: Message = {
  id: "t-1",
  role: "tool",
  toolCallId: "tc-hitl",
  content: '{"approved":true}',
};
const plainResult: Message = {
  id: "t-2",
  role: "tool",
  toolCallId: "tc-plain",
  content: "rendered",
};

function input(overrides: Partial<RunAgentInput> = {}): RunAgentInput {
  return {
    threadId: "thread-1",
    runId: "run-1",
    state: {},
    messages: [assistant, hitlResult, plainResult],
    tools: [hitlTool, plainTool],
    context: [],
    forwardedProps: {},
    ...overrides,
  };
}

describe("buildHitlResponseEvents", () => {
  it("records the user's answer to a human-in-the-loop tool call", () => {
    expect(
      buildHitlResponseEvents({ input: input(), userId: "user-1" }),
    ).toEqual([
      {
        type: EventType.CUSTOM,
        name: HITL_RESPONSE_EVENT_NAME,
        value: {
          toolCallId: "tc-hitl",
          toolName: "approve_refund",
          userId: "user-1",
          outcome: "responded",
        },
      },
    ]);
    expect(HITL_RESPONSE_EVENT_NAME).toBe("copilotkit.hitl_response");
  });

  it("only reports tool results that are new to this run", () => {
    expect(
      buildHitlResponseEvents({
        input: input(),
        persistedInputMessages: [plainResult],
        userId: "user-1",
      }),
    ).toEqual([]);
  });

  it("ignores results whose tool call is not flagged human-in-the-loop", () => {
    expect(
      buildHitlResponseEvents({
        input: input({ tools: [{ ...hitlTool, metadata: undefined }] }),
        userId: "user-1",
      }),
    ).toEqual([]);
  });

  it("ignores tool results with no matching assistant tool call", () => {
    expect(
      buildHitlResponseEvents({
        input: input({ messages: [hitlResult] }),
        userId: "user-1",
      }),
    ).toEqual([]);
  });

  it("maps interrupt resumes to approved and rejected outcomes", () => {
    const events = buildHitlResponseEvents({
      input: input({
        messages: [],
        resume: [
          { interruptId: "int-1", status: "resolved", payload: { ok: true } },
          { interruptId: "int-2", status: "cancelled" },
        ],
      }),
      userId: "user-1",
    });
    expect(events.map((event) => event.value)).toEqual([
      { interruptId: "int-1", userId: "user-1", outcome: "approved" },
      { interruptId: "int-2", userId: "user-1", outcome: "rejected" },
    ]);
  });

  it("omits userId when the run has no resolved user", () => {
    const [event] = buildHitlResponseEvents({ input: input() });
    expect(event!.value).not.toHaveProperty("userId");
  });
});

describe("isReservedCustomEvent", () => {
  it("reserves the copilotkit. CUSTOM namespace", () => {
    expect(
      isReservedCustomEvent({
        type: EventType.CUSTOM,
        name: "copilotkit.hitl_response",
      } as never),
    ).toBe(true);
    expect(
      isReservedCustomEvent({ type: EventType.CUSTOM, name: "stop" } as never),
    ).toBe(false);
    expect(
      isReservedCustomEvent({
        type: EventType.CUSTOM,
        name: "copilotkit_manually_emit_message",
      } as never),
    ).toBe(false);
    expect(
      isReservedCustomEvent({
        type: EventType.TEXT_MESSAGE_START,
        name: "copilotkit.x",
      } as never),
    ).toBe(false);
  });
});
