import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, CustomEvent, RunAgentInput } from "@ag-ui/client";
import { from } from "rxjs";

const child = (
  namespace: string[],
  parent: string,
  value: number,
  name = "chart",
) => ({
  namespace,
  parentToolCallIds: [parent],
  name: `Child ${value}`,
  runs: [
    {
      sourceRunId: `run-${value}`,
      status: "success",
      messages: [
        {
          sourceMessageId: "same-assistant-id",
          role: "assistant",
          content: [
            { type: "text", text: `Child text ${value}` },
            { type: "tool_call", id: "same-call-id", name, args: { value } },
            ...(value === 1
              ? [
                  {
                    type: "tool_call",
                    id: "nested-parent",
                    name: "Agent",
                    args: {},
                  },
                ]
              : []),
          ],
        },
        {
          sourceMessageId: "same-result-id",
          role: "tool",
          toolCallId: "same-call-id",
          content: [{ type: "text", text: `Saved result ${value}` }],
        },
      ],
    },
  ],
});
/** Deterministic import/recovery contract; no runtime or provider is contacted. */
export function childHistoryFixture() {
  return [
    child(["left"], "parent-left", 1),
    child(["right"], "parent-right", 2, "meeting"),
    child(["left", "nested"], "nested-parent", 3),
  ];
}

export function childSnapshotEvents(): CustomEvent[] {
  const histories = childHistoryFixture();
  return histories.flatMap((history, historyIndex) => {
    const json = JSON.stringify(history),
      size = 120;
    const chunkCount = Math.ceil(json.length / size);
    return Array.from({ length: chunkCount }, (_, chunkIndex) => ({
      type: EventType.CUSTOM,
      name: "cpki.child_histories",
      value: {
        version: 2,
        historyIndex,
        historyCount: histories.length,
        chunkIndex,
        chunkCount,
        data: json.slice(chunkIndex * size, (chunkIndex + 1) * size),
      },
    }));
  });
}

export class ChildHistoryFixtureAgent extends AbstractAgent {
  readonly inputs: RunAgentInput[] = [];
  readonly saved: BaseEvent[] = [];
  constructor() {
    super({ agentId: "default", threadId: "test-thread" });
  }
  async detachActiveRun() {}
  run(input: RunAgentInput) {
    this.inputs.push(input);
    const start = {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    };
    let events: BaseEvent[];
    if (!input.resume) {
      events = [
        start,
        ...childSnapshotEvents(),
        {
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [
            {
              id: "root",
              role: "assistant",
              content: "Root response",
              toolCalls: [
                {
                  id: "parent-left",
                  type: "function",
                  function: { name: "Agent", arguments: "{}" },
                },
                {
                  id: "parent-right",
                  type: "function",
                  function: { name: "Agent", arguments: "{}" },
                },
              ],
            },
            {
              id: "root-result-left",
              role: "tool",
              toolCallId: "parent-left",
              content: "Delegated",
            },
            {
              id: "root-result-right",
              role: "tool",
              toolCallId: "parent-right",
              content: "Delegated",
            },
          ],
        },
        {
          type: EventType.CUSTOM,
          name: "claude:assistant_content",
          value: {
            messageId: "live-followup",
            parentToolUseId: "parent-left",
            content: [
              {
                type: "tool_use",
                id: "followup",
                name: "mcp__ag_ui__chart",
                input: { value: 8 },
              },
            ],
          },
        },
        {
          type: EventType.TOOL_CALL_START,
          toolCallId: "followup",
          toolCallName: "chart",
          parentMessageId: "live-followup",
        },
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: "followup",
          delta: '{"value":8}',
        },
        { type: EventType.TOOL_CALL_END, toolCallId: "followup" },
        {
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
          outcome: {
            type: "interrupt",
            interrupts: [
              {
                id: "followup",
                reason: "tool_call",
                metadata: {
                  source: "claude-sdk-native-child",
                  childId: "left",
                  parentToolUseId: "parent-left",
                  toolName: "mcp__ag_ui__chart",
                  input: { value: 8 },
                },
              },
            ],
          },
        },
      ];
    } else {
      const answer = input.resume[0];
      const result =
        answer?.status === "cancelled"
          ? "cancelled"
          : JSON.stringify(answer?.payload);
      events = [
        start,
        {
          type: EventType.TOOL_CALL_RESULT,
          messageId: "followup-result",
          toolCallId: "followup",
          content: result,
          rawEvent: {
            parent_tool_use_id: "parent-left",
            is_error: answer?.status === "cancelled",
          },
        },
        {
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
        },
      ];
    }
    this.saved.push(...events);
    return from(events);
  }
  connect() {
    return from(this.saved);
  }
}
