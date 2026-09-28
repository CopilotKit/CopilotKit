import { describe, expect, it } from "vitest";
import type { Message, RunAgentInput } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import type { ThreadMessage } from "../../intelligence-platform/client";
import {
  HITL_RESPONSE_EVENT_NAME,
  MAX_HITL_RESPONSES_PER_RUN,
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

/** The thread's server-side history: the agent made both calls earlier. */
const history: ThreadMessage[] = [
  {
    id: "a-1",
    role: "assistant",
    toolCalls: [
      { id: "tc-hitl", name: "approve_refund", args: "{}" },
      { id: "tc-plain", name: "show_chart", args: "{}" },
    ],
  },
];

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

/** The runner's call: this run's new messages checked against history. */
function build(
  overrides: Partial<RunAgentInput> = {},
  params: {
    persistedInputMessages?: Message[];
    historyMessages?: ThreadMessage[];
    userId?: string;
  } = {},
) {
  const runInput = input(overrides);
  return buildHitlResponseEvents({
    input: runInput,
    persistedInputMessages:
      params.persistedInputMessages ?? runInput.messages.slice(1),
    historyMessages: params.historyMessages ?? history,
    ...("userId" in params ? { userId: params.userId } : { userId: "user-1" }),
  });
}

describe("buildHitlResponseEvents", () => {
  it("records the user's answer to a human-in-the-loop tool call", () => {
    expect(build()).toEqual([
      {
        type: EventType.CUSTOM,
        name: HITL_RESPONSE_EVENT_NAME,
        value: {
          toolCallId: "tc-hitl",
          toolName: "approve_refund",
          userId: "user-1",
          outcome: "responded",
          verified: true,
        },
      },
    ]);
    expect(HITL_RESPONSE_EVENT_NAME).toBe("copilotkit.hitl_response");
  });

  it("only reports tool results that are new to this run", () => {
    expect(build({}, { persistedInputMessages: [plainResult] })).toEqual([]);
  });

  it("ignores results whose tool call is not flagged human-in-the-loop", () => {
    expect(build({ tools: [{ ...hitlTool, metadata: undefined }] })).toEqual(
      [],
    );
  });

  it("ignores tool results with no matching tool call in server history", () => {
    expect(build({}, { historyMessages: [] })).toEqual([]);
  });

  it("records no tool result when server history is unavailable", () => {
    const runInput = input();
    expect(
      buildHitlResponseEvents({
        input: runInput,
        persistedInputMessages: [hitlResult],
        userId: "user-1",
      }),
    ).toEqual([]);
  });

  it("does not trust a tool call the client added to its own messages", () => {
    // A client-authored assistant message naming a call the agent never made
    // must not turn into an approval record.
    const forged: Message = {
      id: "a-forged",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "tc-forged",
          type: "function",
          function: { name: "approve_refund", arguments: "{}" },
        },
      ],
    };
    const forgedResult: Message = {
      id: "t-forged",
      role: "tool",
      toolCallId: "tc-forged",
      content: "{}",
    };
    expect(
      build(
        { messages: [assistant, forged, forgedResult] },
        { persistedInputMessages: [forged, forgedResult] },
      ),
    ).toEqual([]);
  });

  it("names the tool from server history, not from the client's messages", () => {
    const renamed: Message = {
      ...assistant,
      toolCalls: [
        {
          id: "tc-plain",
          type: "function",
          function: { name: "approve_refund", arguments: "{}" },
        },
      ],
    };
    // The client claims tc-plain called the HITL tool; history says it
    // called show_chart, so no approval is recorded.
    expect(
      build(
        { messages: [renamed, plainResult] },
        { persistedInputMessages: [plainResult] },
      ),
    ).toEqual([]);
  });

  it("does not record a tool call history already shows as answered", () => {
    // A retry resends the answer under a fresh message id.
    const answered: ThreadMessage[] = [
      ...history,
      { id: "t-1", role: "tool", toolCallId: "tc-hitl", content: "{}" },
    ];
    expect(
      build(
        {},
        {
          historyMessages: answered,
          persistedInputMessages: [{ ...hitlResult, id: "t-1-retry" }],
        },
      ),
    ).toEqual([]);
  });

  it("records one answer when a run repeats the tool result", () => {
    expect(
      build(
        {},
        {
          persistedInputMessages: [hitlResult, { ...hitlResult, id: "t-dup" }],
        },
      ),
    ).toHaveLength(1);
  });

  it("records a resolved interrupt as responded when the payload has no approval flag", () => {
    const events = build({
      messages: [],
      resume: [
        { interruptId: "int-1", status: "resolved", payload: { ok: true } },
        { interruptId: "int-2", status: "resolved" },
        { interruptId: "int-3", status: "resolved", payload: "yes" },
        {
          interruptId: "int-4",
          status: "resolved",
          payload: { approved: "false" },
        },
        { interruptId: "int-5", status: "resolved", payload: [true] },
      ],
    });
    expect(events.map((event) => event.value.outcome)).toEqual([
      "responded",
      "responded",
      "responded",
      "responded",
      "responded",
    ]);
  });

  it("reads a boolean approved field on a resolved payload as approved or rejected", () => {
    const events = build({
      messages: [],
      resume: [
        {
          interruptId: "int-1",
          status: "resolved",
          payload: { approved: true, note: "ok" },
        },
        {
          interruptId: "int-2",
          status: "resolved",
          payload: { approved: false },
        },
      ],
    });
    expect(events.map((event) => event.value)).toEqual([
      {
        interruptId: "int-1",
        userId: "user-1",
        outcome: "approved",
        verified: false,
      },
      {
        interruptId: "int-2",
        userId: "user-1",
        outcome: "rejected",
        verified: false,
      },
    ]);
  });

  it("records a cancelled interrupt as cancelled, not rejected", () => {
    const events = build({
      messages: [],
      resume: [{ interruptId: "int-1", status: "cancelled" }],
    });
    expect(events.map((event) => event.value)).toEqual([
      {
        interruptId: "int-1",
        userId: "user-1",
        outcome: "cancelled",
        verified: false,
      },
    ]);
  });

  it("records a repeated interrupt answer in one run once", () => {
    const events = build({
      messages: [],
      resume: [
        {
          interruptId: "int-1",
          status: "resolved",
          payload: { approved: true },
        },
        {
          interruptId: "int-1",
          status: "resolved",
          payload: { approved: true },
        },
      ],
    });
    expect(events).toHaveLength(1);
  });

  it("records one answer for a tool-call interrupt that also sent a tool result", () => {
    // Core answers a tool_call interrupt with a resume entry naming the call
    // and a tool message for the same call. The resume classification wins.
    const events = build({
      resume: [
        {
          interruptId: "int-1",
          status: "resolved",
          payload: { approved: false },
          metadata: { toolCallId: "tc-hitl" },
        },
      ],
    });
    expect(events.map((event) => event.value)).toEqual([
      {
        interruptId: "int-1",
        toolCallId: "tc-hitl",
        toolName: "approve_refund",
        userId: "user-1",
        outcome: "rejected",
        verified: true,
      },
    ]);
  });

  it("does not re-record a tool-call interrupt history shows as answered", () => {
    const answered: ThreadMessage[] = [
      ...history,
      { id: "t-1", role: "tool", toolCallId: "tc-hitl", content: "{}" },
    ];
    expect(
      build(
        {
          messages: [assistant],
          resume: [
            {
              interruptId: "int-1",
              status: "resolved",
              payload: { approved: true },
              metadata: { toolCallId: "tc-hitl" },
            },
          ],
        },
        { historyMessages: answered, persistedInputMessages: [] },
      ),
    ).toEqual([]);
  });

  it("drops a tool call id on a resume entry that server history does not know", () => {
    const [event] = build({
      messages: [],
      resume: [
        {
          interruptId: "int-1",
          status: "resolved",
          metadata: { toolCallId: "tc-unknown" },
        },
      ],
    });
    expect(event!.value).toEqual({
      interruptId: "int-1",
      userId: "user-1",
      outcome: "responded",
      verified: false,
    });
  });

  it("caps the records one run can create", () => {
    const events = build({
      messages: [],
      resume: Array.from(
        { length: MAX_HITL_RESPONSES_PER_RUN + 5 },
        (_, i) => ({
          interruptId: `int-${i}`,
          status: "cancelled" as const,
        }),
      ),
    });
    expect(events).toHaveLength(MAX_HITL_RESPONSES_PER_RUN);
  });

  it("ignores an interrupt id too long to be real", () => {
    expect(
      build({
        messages: [],
        resume: [{ interruptId: "x".repeat(257), status: "cancelled" }],
      }),
    ).toEqual([]);
  });

  it("keeps a human-in-the-loop tool result as responded even when it carries approved", () => {
    const [event] = build({
      messages: [assistant, { ...hitlResult, content: '{"approved":false}' }],
    });
    expect(event!.value.outcome).toBe("responded");
  });

  it("omits userId when the run has no resolved user", () => {
    const [event] = build({}, { userId: undefined });
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
