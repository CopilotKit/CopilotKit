import type {
  CreateElicitationRequest,
  PromptResponse,
  RequestId,
  RequestPermissionRequest,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";

type AcpToolCallState = Extract<
  SessionUpdate,
  { sessionUpdate: "tool_call" | "tool_call_update" }
>;

/** Active-turn reducer state used to join ACP chunks into AG-UI messages. */
export interface AcpTranslationState {
  readonly activitySequence: number;
  readonly openAgentMessage?: {
    readonly acpMessageId: string | null;
    readonly aguiMessageId: string;
  };
  readonly openThoughtMessage?: {
    readonly acpMessageId: string | null;
    readonly aguiMessageId: string;
  };
  readonly syntheticMessageSequence: number;
  readonly toolCalls: Readonly<Record<string, AcpToolCallState>>;
}

/** Output from applying one ACP session update. */
export interface AcpTranslationResult {
  readonly events: readonly BaseEvent[];
  readonly state: AcpTranslationState;
}

/** Identifies the AG-UI run that wraps one ACP prompt segment. */
export interface AcpRunIdentity {
  readonly runId: string;
  readonly threadId: string;
}

/** Correlates one live ACP permission request with its AG-UI run. */
export interface AcpPermissionIdentity extends AcpRunIdentity {
  readonly requestId: RequestId;
}

/** Public, stable error details emitted when one ACP run cannot continue. */
export interface AcpRunErrorInput {
  readonly code: string;
  readonly message: string;
  readonly rawEvent?: unknown;
}

/** Creates empty translation state for one active ACP prompt. */
export function createAcpTranslationState(): AcpTranslationState {
  return {
    activitySequence: 0,
    syntheticMessageSequence: 0,
    toolCalls: {},
  };
}

/** Starts the AG-UI run segment that wraps one ACP prompt or resume. */
export function createAcpRunStarted(identity: AcpRunIdentity): BaseEvent {
  return {
    type: EventType.RUN_STARTED,
    threadId: identity.threadId,
    runId: identity.runId,
  };
}

/** Applies one ACP v1 session update to the current AG-UI run segment. */
export function translateAcpSessionUpdate(
  state: AcpTranslationState,
  update: SessionUpdate,
): AcpTranslationResult {
  if (
    update.sessionUpdate === "agent_message_chunk" &&
    update.content.type === "text"
  ) {
    const usesSyntheticId = update.messageId == null;
    const acpMessageId = update.messageId ?? null;
    const isContinuation =
      state.openAgentMessage?.acpMessageId === acpMessageId;
    const syntheticMessageSequence =
      usesSyntheticId && !isContinuation
        ? state.syntheticMessageSequence + 1
        : state.syntheticMessageSequence;
    const aguiMessageId =
      state.openAgentMessage && isContinuation
        ? state.openAgentMessage.aguiMessageId
        : usesSyntheticId
          ? `acp:agent:${syntheticMessageSequence}`
          : `acp:${update.messageId}`;
    const startEvents: readonly BaseEvent[] = isContinuation
      ? []
      : [
          {
            type: EventType.TEXT_MESSAGE_START,
            messageId: aguiMessageId,
            role: "assistant",
          },
        ];
    const endEvents: readonly BaseEvent[] =
      state.openAgentMessage && !isContinuation
        ? [
            {
              type: EventType.TEXT_MESSAGE_END,
              messageId: state.openAgentMessage.aguiMessageId,
            },
          ]
        : [];
    const reasoningEndEvents: readonly BaseEvent[] = state.openThoughtMessage
      ? [
          {
            type: EventType.REASONING_MESSAGE_END,
            messageId: state.openThoughtMessage.aguiMessageId,
          },
          {
            type: EventType.REASONING_END,
            messageId: state.openThoughtMessage.aguiMessageId,
          },
        ]
      : [];

    return {
      events: [
        ...reasoningEndEvents,
        ...endEvents,
        ...startEvents,
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: aguiMessageId,
          delta: update.content.text,
        },
      ],
      state: {
        activitySequence: state.activitySequence,
        openAgentMessage: { acpMessageId, aguiMessageId },
        syntheticMessageSequence,
        toolCalls: state.toolCalls,
      },
    };
  }
  if (
    update.sessionUpdate === "agent_message_chunk" &&
    update.content.type !== "text"
  ) {
    const activitySequence = state.activitySequence + 1;
    return {
      events: [
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: `acp:activity:${activitySequence}`,
          activityType: "acp.content",
          replace: true,
          content: {
            sessionUpdate: update.sessionUpdate,
            acpMessageId: update.messageId ?? null,
            content: update.content,
          },
        },
      ],
      state: { ...state, activitySequence },
    };
  }
  if (
    update.sessionUpdate === "agent_thought_chunk" &&
    update.content.type === "text"
  ) {
    const usesSyntheticId = update.messageId == null;
    const acpMessageId = update.messageId ?? null;
    const isContinuation =
      state.openThoughtMessage?.acpMessageId === acpMessageId;
    const syntheticMessageSequence =
      usesSyntheticId && !isContinuation
        ? state.syntheticMessageSequence + 1
        : state.syntheticMessageSequence;
    const aguiMessageId =
      state.openThoughtMessage && isContinuation
        ? state.openThoughtMessage.aguiMessageId
        : usesSyntheticId
          ? `acp:thought:${syntheticMessageSequence}`
          : `acp:${update.messageId}`;
    const closeEvents: readonly BaseEvent[] =
      !isContinuation && state.openThoughtMessage
        ? [
            {
              type: EventType.REASONING_MESSAGE_END,
              messageId: state.openThoughtMessage.aguiMessageId,
            },
            {
              type: EventType.REASONING_END,
              messageId: state.openThoughtMessage.aguiMessageId,
            },
          ]
        : [];
    const startEvents: readonly BaseEvent[] = isContinuation
      ? []
      : [
          {
            type: EventType.REASONING_START,
            messageId: aguiMessageId,
          },
          {
            type: EventType.REASONING_MESSAGE_START,
            messageId: aguiMessageId,
            role: "reasoning",
          },
        ];

    return {
      events: [
        ...closeEvents,
        ...startEvents,
        {
          type: EventType.REASONING_MESSAGE_CONTENT,
          messageId: aguiMessageId,
          delta: update.content.text,
        },
      ],
      state: {
        ...state,
        openThoughtMessage: { acpMessageId, aguiMessageId },
        syntheticMessageSequence,
      },
    };
  }
  if (
    update.sessionUpdate === "agent_thought_chunk" &&
    update.content.type !== "text"
  ) {
    const activitySequence = state.activitySequence + 1;
    return {
      events: [
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: `acp:activity:${activitySequence}`,
          activityType: "acp.thought",
          replace: true,
          content: update,
        },
      ],
      state: { ...state, activitySequence },
    };
  }
  if (update.sessionUpdate === "user_message_chunk") {
    const activitySequence = state.activitySequence + 1;
    return {
      events: [
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: `acp:activity:${activitySequence}`,
          activityType: "acp.user_message",
          replace: true,
          content: update,
        },
      ],
      state: { ...state, activitySequence },
    };
  }
  if (update.sessionUpdate === "tool_call") {
    return {
      events: [
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: `acp:tool:${update.toolCallId}`,
          activityType: "acp.tool_call",
          replace: true,
          content: update,
        },
      ],
      state: {
        ...state,
        toolCalls: { ...state.toolCalls, [update.toolCallId]: update },
      },
    };
  }
  if (update.sessionUpdate === "tool_call_update") {
    const current = state.toolCalls[update.toolCallId];
    const nonNullUpdate = Object.fromEntries(
      Object.entries(update).filter(
        ([key, value]) =>
          key === "sessionUpdate" || key === "toolCallId" || value != null,
      ),
    );
    const snapshot = {
      ...current,
      ...nonNullUpdate,
      sessionUpdate: "tool_call_update" as const,
      toolCallId: update.toolCallId,
    };
    return {
      events: [
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: `acp:tool:${update.toolCallId}`,
          activityType: "acp.tool_call",
          replace: true,
          content: snapshot,
        },
      ],
      state: {
        ...state,
        toolCalls: { ...state.toolCalls, [update.toolCallId]: snapshot },
      },
    };
  }
  if (update.sessionUpdate === "plan") {
    return {
      events: [
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: "acp:plan:default",
          activityType: "acp.plan",
          replace: true,
          content: update,
        },
      ],
      state,
    };
  }
  if (update.sessionUpdate === "plan_update") {
    return {
      events: [
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: `acp:plan:${update.plan.planId}`,
          activityType: "acp.plan",
          replace: true,
          content: update,
        },
      ],
      state,
    };
  }
  if (update.sessionUpdate === "plan_removed") {
    return {
      events: [
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: `acp:plan:${update.planId}`,
          activityType: "acp.plan",
          replace: true,
          content: update,
        },
      ],
      state,
    };
  }
  if (update.sessionUpdate === "available_commands_update") {
    return {
      events: [
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: "acp:session:commands",
          activityType: "acp.available_commands",
          replace: true,
          content: update,
        },
      ],
      state,
    };
  }
  if (update.sessionUpdate === "current_mode_update") {
    return {
      events: [
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: "acp:session:mode",
          activityType: "acp.session_mode",
          replace: true,
          content: update,
        },
      ],
      state,
    };
  }
  if (update.sessionUpdate === "config_option_update") {
    return {
      events: [
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: "acp:session:config",
          activityType: "acp.session_config",
          replace: true,
          content: update,
        },
      ],
      state,
    };
  }
  if (update.sessionUpdate === "session_info_update") {
    return {
      events: [
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: "acp:session:info",
          activityType: "acp.session_info",
          replace: true,
          content: update,
        },
      ],
      state,
    };
  }
  return {
    events: [
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: "acp:session:usage",
        activityType: "acp.usage",
        replace: true,
        content: update,
      },
    ],
    state,
  };
}

/** Closes open streams and records the exact ACP prompt result. */
export function finishAcpPrompt(
  state: AcpTranslationState,
  identity: AcpRunIdentity,
  response: PromptResponse,
): AcpTranslationResult {
  const closingReasoningEvents: readonly BaseEvent[] = state.openThoughtMessage
    ? [
        {
          type: EventType.REASONING_MESSAGE_END,
          messageId: state.openThoughtMessage.aguiMessageId,
        },
        {
          type: EventType.REASONING_END,
          messageId: state.openThoughtMessage.aguiMessageId,
        },
      ]
    : [];
  const closingTextEvents: readonly BaseEvent[] = state.openAgentMessage
    ? [
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: state.openAgentMessage.aguiMessageId,
        },
      ]
    : [];
  return {
    events: [
      ...closingReasoningEvents,
      ...closingTextEvents,
      {
        type: EventType.RUN_FINISHED,
        threadId: identity.threadId,
        runId: identity.runId,
        outcome: { type: "success" },
        result: {
          acp: {
            stopReason: response.stopReason,
            ...(response.usage ? { usage: response.usage } : {}),
          },
        },
      },
    ],
    state: {
      activitySequence: state.activitySequence,
      syntheticMessageSequence: state.syntheticMessageSequence,
      toolCalls: {},
    },
  };
}

/** Closes open streams and emits one stable AG-UI error. */
export function createAcpRunError(
  state: AcpTranslationState,
  error: AcpRunErrorInput,
): AcpTranslationResult {
  const closingReasoningEvents: readonly BaseEvent[] = state.openThoughtMessage
    ? [
        {
          type: EventType.REASONING_MESSAGE_END,
          messageId: state.openThoughtMessage.aguiMessageId,
        },
        {
          type: EventType.REASONING_END,
          messageId: state.openThoughtMessage.aguiMessageId,
        },
      ]
    : [];
  const closingTextEvents: readonly BaseEvent[] = state.openAgentMessage
    ? [
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: state.openAgentMessage.aguiMessageId,
        },
      ]
    : [];
  return {
    events: [
      ...closingReasoningEvents,
      ...closingTextEvents,
      {
        type: EventType.RUN_ERROR,
        code: error.code,
        message: error.message,
        ...(error.rawEvent === undefined ? {} : { rawEvent: error.rawEvent }),
      },
    ],
    state: {
      activitySequence: state.activitySequence,
      syntheticMessageSequence: state.syntheticMessageSequence,
      toolCalls: {},
    },
  };
}

/** Ends one AG-UI segment while leaving its ACP permission request pending. */
export function createAcpPermissionInterrupt(
  state: AcpTranslationState,
  identity: AcpPermissionIdentity,
  request: RequestPermissionRequest,
): AcpTranslationResult {
  const reasoningEndEvents: readonly BaseEvent[] = state.openThoughtMessage
    ? [
        {
          type: EventType.REASONING_MESSAGE_END,
          messageId: state.openThoughtMessage.aguiMessageId,
        },
        {
          type: EventType.REASONING_END,
          messageId: state.openThoughtMessage.aguiMessageId,
        },
      ]
    : [];
  const textEndEvents: readonly BaseEvent[] = state.openAgentMessage
    ? [
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: state.openAgentMessage.aguiMessageId,
        },
      ]
    : [];
  const interruptId = `acp:permission:${String(identity.requestId)}`;
  return {
    events: [
      ...reasoningEndEvents,
      ...textEndEvents,
      {
        type: EventType.RUN_FINISHED,
        threadId: identity.threadId,
        runId: identity.runId,
        outcome: {
          type: "interrupt",
          interrupts: [
            {
              id: interruptId,
              reason: "tool_call",
              message: request.toolCall.title ?? "ACP tool permission",
              toolCallId: request.toolCall.toolCallId,
              responseSchema: {
                type: "object",
                properties: {
                  optionId: {
                    type: "string",
                    enum: request.options.map((option) => option.optionId),
                  },
                },
                required: ["optionId"],
                additionalProperties: false,
              },
              metadata: {
                acp: {
                  requestId: identity.requestId,
                  options: request.options,
                },
              },
            },
          ],
        },
      },
    ],
    state: {
      activitySequence: state.activitySequence,
      syntheticMessageSequence: state.syntheticMessageSequence,
      toolCalls: state.toolCalls,
    },
  };
}

/** Ends one AG-UI segment while an ACP form or URL elicitation stays pending. */
export function createAcpElicitationInterrupt(
  state: AcpTranslationState,
  identity: AcpPermissionIdentity,
  request: CreateElicitationRequest,
): AcpTranslationResult {
  const reasoningEndEvents: readonly BaseEvent[] = state.openThoughtMessage
    ? [
        {
          type: EventType.REASONING_MESSAGE_END,
          messageId: state.openThoughtMessage.aguiMessageId,
        },
        {
          type: EventType.REASONING_END,
          messageId: state.openThoughtMessage.aguiMessageId,
        },
      ]
    : [];
  const textEndEvents: readonly BaseEvent[] = state.openAgentMessage
    ? [
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: state.openAgentMessage.aguiMessageId,
        },
      ]
    : [];
  const interruptId = `acp:elicitation:${String(identity.requestId)}`;
  const formSchema =
    request.mode === "form" && "requestedSchema" in request
      ? {
          type: "object" as const,
          properties: {
            action: { type: "string", enum: ["accept", "decline"] },
            content: request.requestedSchema,
          },
          required: ["action"],
          additionalProperties: false,
        }
      : {
          type: "object" as const,
          properties: {
            action: { type: "string", enum: ["accept", "decline"] },
          },
          required: ["action"],
          additionalProperties: false,
        };
  return {
    events: [
      ...reasoningEndEvents,
      ...textEndEvents,
      {
        type: EventType.RUN_FINISHED,
        threadId: identity.threadId,
        runId: identity.runId,
        outcome: {
          type: "interrupt",
          interrupts: [
            {
              id: interruptId,
              reason:
                request.mode === "form"
                  ? "input_required"
                  : request.mode === "url"
                    ? "acp:url_elicitation"
                    : "acp:elicitation",
              message: request.message,
              responseSchema: formSchema,
              metadata: {
                acp: {
                  requestId: identity.requestId,
                  request,
                },
              },
            },
          ],
        },
      },
    ],
    state: {
      activitySequence: state.activitySequence,
      syntheticMessageSequence: state.syntheticMessageSequence,
      toolCalls: state.toolCalls,
    },
  };
}
