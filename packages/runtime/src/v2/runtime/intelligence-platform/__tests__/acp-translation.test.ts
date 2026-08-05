import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { EventSchemas, EventType } from "@ag-ui/client";
import { expect, test } from "vitest";
import {
  createAcpPermissionInterrupt,
  createAcpElicitationInterrupt,
  createAcpRunError,
  createAcpRunStarted,
  createAcpTranslationState,
  finishAcpPrompt,
  translateAcpSessionUpdate,
} from "../acp-translation";

test("an ACP agent text chunk starts and fills one AG-UI assistant message", () => {
  const result = translateAcpSessionUpdate(createAcpTranslationState(), {
    sessionUpdate: "agent_message_chunk",
    messageId: "answer-1",
    content: { type: "text", text: "Hello from ACP" },
  });

  expect(result.events).toEqual([
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "acp:answer-1",
      role: "assistant",
    },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "acp:answer-1",
      delta: "Hello from ACP",
    },
  ]);
});

test("later ACP chunks with the same message id continue the open AG-UI message", () => {
  const first = translateAcpSessionUpdate(createAcpTranslationState(), {
    sessionUpdate: "agent_message_chunk",
    messageId: "answer-1",
    content: { type: "text", text: "Hello" },
  });
  const second = translateAcpSessionUpdate(first.state, {
    sessionUpdate: "agent_message_chunk",
    messageId: "answer-1",
    content: { type: "text", text: " again" },
  });

  expect(second.events).toEqual([
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "acp:answer-1",
      delta: " again",
    },
  ]);
});

test("a new ACP message id closes the prior AG-UI message before starting the next", () => {
  const first = translateAcpSessionUpdate(createAcpTranslationState(), {
    sessionUpdate: "agent_message_chunk",
    messageId: "answer-1",
    content: { type: "text", text: "First" },
  });
  const second = translateAcpSessionUpdate(first.state, {
    sessionUpdate: "agent_message_chunk",
    messageId: "answer-2",
    content: { type: "text", text: "Second" },
  });

  expect(second.events).toEqual([
    {
      type: EventType.TEXT_MESSAGE_END,
      messageId: "acp:answer-1",
    },
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "acp:answer-2",
      role: "assistant",
    },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "acp:answer-2",
      delta: "Second",
    },
  ]);
});

test("an ACP prompt result closes text and preserves its stop reason on RUN_FINISHED", () => {
  const streamed = translateAcpSessionUpdate(createAcpTranslationState(), {
    sessionUpdate: "agent_message_chunk",
    messageId: "answer-1",
    content: { type: "text", text: "Partial answer" },
  });
  const finished = finishAcpPrompt(
    streamed.state,
    { threadId: "thread-1", runId: "run-1" },
    { stopReason: "max_tokens" },
  );

  expect(finished.events).toEqual([
    {
      type: EventType.TEXT_MESSAGE_END,
      messageId: "acp:answer-1",
    },
    {
      type: EventType.RUN_FINISHED,
      threadId: "thread-1",
      runId: "run-1",
      outcome: { type: "success" },
      result: { acp: { stopReason: "max_tokens" } },
    },
  ]);
  expect(finished.state.openAgentMessage).toBeUndefined();
});

test("ACP thought text maps to the AG-UI reasoning lifecycle", () => {
  const result = translateAcpSessionUpdate(createAcpTranslationState(), {
    sessionUpdate: "agent_thought_chunk",
    messageId: "thought-1",
    content: { type: "text", text: "Check the constraints" },
  });

  expect(result.events).toEqual([
    {
      type: EventType.REASONING_START,
      messageId: "acp:thought-1",
    },
    {
      type: EventType.REASONING_MESSAGE_START,
      messageId: "acp:thought-1",
      role: "reasoning",
    },
    {
      type: EventType.REASONING_MESSAGE_CONTENT,
      messageId: "acp:thought-1",
      delta: "Check the constraints",
    },
  ]);
});

test("a new ACP thought id closes the prior reasoning lifecycle", () => {
  const first = translateAcpSessionUpdate(createAcpTranslationState(), {
    sessionUpdate: "agent_thought_chunk",
    messageId: "thought-1",
    content: { type: "text", text: "First" },
  });
  const second = translateAcpSessionUpdate(first.state, {
    sessionUpdate: "agent_thought_chunk",
    messageId: "thought-2",
    content: { type: "text", text: "Second" },
  });

  expect(second.events.slice(0, 2)).toEqual([
    {
      type: EventType.REASONING_MESSAGE_END,
      messageId: "acp:thought-1",
    },
    {
      type: EventType.REASONING_END,
      messageId: "acp:thought-1",
    },
  ]);
  expect(second.events.slice(2, 4)).toEqual([
    {
      type: EventType.REASONING_START,
      messageId: "acp:thought-2",
    },
    {
      type: EventType.REASONING_MESSAGE_START,
      messageId: "acp:thought-2",
      role: "reasoning",
    },
  ]);
});

test("an ACP prompt result closes an open AG-UI reasoning lifecycle", () => {
  const streamed = translateAcpSessionUpdate(createAcpTranslationState(), {
    sessionUpdate: "agent_thought_chunk",
    messageId: "thought-1",
    content: { type: "text", text: "Check the constraints" },
  });
  const finished = finishAcpPrompt(
    streamed.state,
    { threadId: "thread-1", runId: "run-1" },
    { stopReason: "end_turn" },
  );

  expect(finished.events.slice(0, 2)).toEqual([
    {
      type: EventType.REASONING_MESSAGE_END,
      messageId: "acp:thought-1",
    },
    {
      type: EventType.REASONING_END,
      messageId: "acp:thought-1",
    },
  ]);
});

test("the first ACP answer chunk closes reasoning before assistant text starts", () => {
  const thought = translateAcpSessionUpdate(createAcpTranslationState(), {
    sessionUpdate: "agent_thought_chunk",
    messageId: "thought-1",
    content: { type: "text", text: "Consider it" },
  });
  const answer = translateAcpSessionUpdate(thought.state, {
    sessionUpdate: "agent_message_chunk",
    messageId: "answer-1",
    content: { type: "text", text: "Done" },
  });

  expect(answer.events.slice(0, 2)).toEqual([
    {
      type: EventType.REASONING_MESSAGE_END,
      messageId: "acp:thought-1",
    },
    {
      type: EventType.REASONING_END,
      messageId: "acp:thought-1",
    },
  ]);
  expect(answer.state.openThoughtMessage).toBeUndefined();
});

test("ACP image output stays lossless in a persisted AG-UI activity", () => {
  const result = translateAcpSessionUpdate(createAcpTranslationState(), {
    sessionUpdate: "agent_message_chunk",
    messageId: "answer-1",
    content: {
      type: "image",
      data: "aGVsbG8=",
      mimeType: "image/png",
      uri: "artifact://preview",
    },
  });

  expect(result.events).toEqual([
    {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "acp:activity:1",
      activityType: "acp.content",
      replace: true,
      content: {
        sessionUpdate: "agent_message_chunk",
        acpMessageId: "answer-1",
        content: {
          type: "image",
          data: "aGVsbG8=",
          mimeType: "image/png",
          uri: "artifact://preview",
        },
      },
    },
  ]);
});

test("an ACP tool call becomes an AG-UI activity instead of a frontend tool call", () => {
  const result = translateAcpSessionUpdate(createAcpTranslationState(), {
    sessionUpdate: "tool_call",
    toolCallId: "call-1",
    title: "Read the package manifest",
    kind: "read",
    status: "in_progress",
    rawInput: { path: "package.json" },
  });

  expect(result.events).toEqual([
    {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "acp:tool:call-1",
      activityType: "acp.tool_call",
      replace: true,
      content: {
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "Read the package manifest",
        kind: "read",
        status: "in_progress",
        rawInput: { path: "package.json" },
      },
    },
  ]);
  expect(result.events.map((event) => event.type)).not.toContain(
    EventType.TOOL_CALL_START,
  );
});

test("an ACP tool update replaces the activity with a merged lossless snapshot", () => {
  const started = translateAcpSessionUpdate(createAcpTranslationState(), {
    sessionUpdate: "tool_call",
    toolCallId: "call-1",
    title: "Read the package manifest",
    kind: "read",
    status: "in_progress",
    rawInput: { path: "package.json" },
  });
  const completed = translateAcpSessionUpdate(started.state, {
    sessionUpdate: "tool_call_update",
    toolCallId: "call-1",
    status: "completed",
    rawOutput: { bytes: 2048 },
  });

  expect(completed.events).toEqual([
    {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "acp:tool:call-1",
      activityType: "acp.tool_call",
      replace: true,
      content: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        title: "Read the package manifest",
        kind: "read",
        status: "completed",
        rawInput: { path: "package.json" },
        rawOutput: { bytes: 2048 },
      },
    },
  ]);
});

test("an ACP plan replaces one stable AG-UI plan activity", () => {
  const result = translateAcpSessionUpdate(createAcpTranslationState(), {
    sessionUpdate: "plan",
    entries: [
      {
        content: "Inspect the repository",
        priority: "high",
        status: "completed",
      },
      {
        content: "Apply the change",
        priority: "medium",
        status: "in_progress",
      },
    ],
  });

  expect(result.events).toEqual([
    {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "acp:plan:default",
      activityType: "acp.plan",
      replace: true,
      content: {
        sessionUpdate: "plan",
        entries: [
          {
            content: "Inspect the repository",
            priority: "high",
            status: "completed",
          },
          {
            content: "Apply the change",
            priority: "medium",
            status: "in_progress",
          },
        ],
      },
    },
  ]);
});

test("ACP slash commands stay available in a typed AG-UI session activity", () => {
  const result = translateAcpSessionUpdate(createAcpTranslationState(), {
    sessionUpdate: "available_commands_update",
    availableCommands: [
      {
        name: "review",
        description: "Review the current change",
        input: { hint: "optional focus" },
      },
    ],
  });

  expect(result.events).toEqual([
    {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "acp:session:commands",
      activityType: "acp.available_commands",
      replace: true,
      content: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          {
            name: "review",
            description: "Review the current change",
            input: { hint: "optional focus" },
          },
        ],
      },
    },
  ]);
});

test("an ACP permission request ends the AG-UI run with a standard interrupt", () => {
  const interrupted = createAcpPermissionInterrupt(
    createAcpTranslationState(),
    { threadId: "thread-1", runId: "run-1", requestId: "permission-7" },
    {
      sessionId: "session-1",
      toolCall: {
        toolCallId: "call-1",
        title: "Write package.json",
        kind: "edit",
        status: "pending",
      },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    },
  );

  expect(interrupted.events).toEqual([
    {
      type: EventType.RUN_FINISHED,
      threadId: "thread-1",
      runId: "run-1",
      outcome: {
        type: "interrupt",
        interrupts: [
          {
            id: "acp:permission:permission-7",
            reason: "tool_call",
            message: "Write package.json",
            toolCallId: "call-1",
            responseSchema: {
              type: "object",
              properties: {
                optionId: {
                  type: "string",
                  enum: ["allow-once", "reject-once"],
                },
              },
              required: ["optionId"],
              additionalProperties: false,
            },
            metadata: {
              acp: {
                requestId: "permission-7",
                options: [
                  {
                    optionId: "allow-once",
                    name: "Allow once",
                    kind: "allow_once",
                  },
                  {
                    optionId: "reject-once",
                    name: "Reject",
                    kind: "reject_once",
                  },
                ],
              },
            },
          },
        ],
      },
    },
  ]);
});

test("rich ACP thought content stays lossless in a thought activity", () => {
  const update: SessionUpdate = {
    sessionUpdate: "agent_thought_chunk",
    messageId: "thought-1",
    content: {
      type: "resource_link",
      name: "analysis.txt",
      uri: "artifact://analysis.txt",
      mimeType: "text/plain",
    },
  };
  const result = translateAcpSessionUpdate(createAcpTranslationState(), update);

  expect(result.events).toEqual([
    {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "acp:activity:1",
      activityType: "acp.thought",
      replace: true,
      content: update,
    },
  ]);
});

test.each([
  {
    update: {
      sessionUpdate: "current_mode_update",
      currentModeId: "architect",
    } satisfies SessionUpdate,
    messageId: "acp:session:mode",
    activityType: "acp.session_mode",
  },
  {
    update: {
      sessionUpdate: "session_info_update",
      title: "Review ACP bridge",
      updatedAt: "2026-08-04T19:00:00.000Z",
    } satisfies SessionUpdate,
    messageId: "acp:session:info",
    activityType: "acp.session_info",
  },
  {
    update: {
      sessionUpdate: "usage_update",
      used: 100,
      size: 200_000,
      cost: { amount: 0.03, currency: "USD" },
    } satisfies SessionUpdate,
    messageId: "acp:session:usage",
    activityType: "acp.usage",
  },
] as const)(
  "$update.sessionUpdate stays visible as $activityType",
  ({ update, messageId, activityType }) => {
    const result = translateAcpSessionUpdate(
      createAcpTranslationState(),
      update,
    );

    expect(result.events).toEqual([
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId,
        activityType,
        replace: true,
        content: update,
      },
    ]);
  },
);

test("ACP user echo content is preserved without duplicating AG-UI user history", () => {
  const update: SessionUpdate = {
    sessionUpdate: "user_message_chunk",
    messageId: "user-1",
    content: { type: "text", text: "Hello" },
  };
  const result = translateAcpSessionUpdate(createAcpTranslationState(), update);

  expect(result.events).toEqual([
    {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "acp:activity:1",
      activityType: "acp.user_message",
      replace: true,
      content: update,
    },
  ]);
});

test("an ACP run starts with the canonical AG-UI run identity", () => {
  expect(createAcpRunStarted({ threadId: "thread-1", runId: "run-1" })).toEqual(
    {
      type: EventType.RUN_STARTED,
      threadId: "thread-1",
      runId: "run-1",
    },
  );
});

test("an uncertain ACP failure closes streams and emits one coded RUN_ERROR", () => {
  const streamed = translateAcpSessionUpdate(createAcpTranslationState(), {
    sessionUpdate: "agent_message_chunk",
    messageId: "answer-1",
    content: { type: "text", text: "Partial" },
  });
  const failed = createAcpRunError(streamed.state, {
    code: "ACP_ACTIVE_PROMPT_UNCERTAIN",
    message: "The ACP worker stopped during an active prompt.",
    rawEvent: { acp: { recovery: "failed_uncertain" } },
  });

  expect(failed.events).toEqual([
    {
      type: EventType.TEXT_MESSAGE_END,
      messageId: "acp:answer-1",
    },
    {
      type: EventType.RUN_ERROR,
      code: "ACP_ACTIVE_PROMPT_UNCERTAIN",
      message: "The ACP worker stopped during an active prompt.",
      rawEvent: { acp: { recovery: "failed_uncertain" } },
    },
  ]);
  expect(failed.state.openAgentMessage).toBeUndefined();
});

test("translated AG-UI events satisfy their exact public schemas", () => {
  const started = createAcpRunStarted({ threadId: "thread-1", runId: "run-1" });
  const streamed = translateAcpSessionUpdate(createAcpTranslationState(), {
    sessionUpdate: "agent_message_chunk",
    messageId: "answer-1",
    content: { type: "text", text: "Hello" },
  });
  const finished = finishAcpPrompt(
    streamed.state,
    { threadId: "thread-1", runId: "run-1" },
    { stopReason: "end_turn" },
  );

  for (const event of [started, ...streamed.events, ...finished.events]) {
    expect(EventSchemas.safeParse(event).success).toBe(true);
  }
});

test("an ACP form elicitation becomes a structured AG-UI input interrupt", () => {
  const interrupted = createAcpElicitationInterrupt(
    createAcpTranslationState(),
    { threadId: "thread-1", runId: "run-1", requestId: "request-9" },
    {
      mode: "form",
      sessionId: "session-1",
      message: "Choose the review scope",
      requestedSchema: {
        type: "object",
        properties: {
          branch: { type: "string", title: "Branch" },
          includeTests: { type: "boolean", title: "Include tests" },
        },
        required: ["branch"],
      },
    },
  );

  expect(interrupted.events).toEqual([
    {
      type: EventType.RUN_FINISHED,
      threadId: "thread-1",
      runId: "run-1",
      outcome: {
        type: "interrupt",
        interrupts: [
          {
            id: "acp:elicitation:request-9",
            reason: "input_required",
            message: "Choose the review scope",
            responseSchema: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["accept", "decline"] },
                content: {
                  type: "object",
                  properties: {
                    branch: { type: "string", title: "Branch" },
                    includeTests: { type: "boolean", title: "Include tests" },
                  },
                  required: ["branch"],
                },
              },
              required: ["action"],
              additionalProperties: false,
            },
            metadata: {
              acp: {
                requestId: "request-9",
                request: {
                  mode: "form",
                  sessionId: "session-1",
                  message: "Choose the review scope",
                  requestedSchema: {
                    type: "object",
                    properties: {
                      branch: { type: "string", title: "Branch" },
                      includeTests: {
                        type: "boolean",
                        title: "Include tests",
                      },
                    },
                    required: ["branch"],
                  },
                },
              },
            },
          },
        ],
      },
    },
  ]);
});
