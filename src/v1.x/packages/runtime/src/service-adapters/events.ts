import {
  Action,
  CopilotKitError,
  CopilotKitErrorCode,
  CopilotKitLowLevelError,
  ensureStructuredError,
  randomId,
  Severity,
} from "@copilotkit/shared";
import { plainToInstance } from "class-transformer";
import {
  catchError,
  concat,
  concatMap,
  EMPTY,
  firstValueFrom,
  from,
  of,
  ReplaySubject,
  scan,
  Subject,
} from "rxjs";
import { ActionInput } from "../graphql/inputs/action.input";
import { ActionExecutionMessage, ResultMessage, TextMessage } from "../graphql/types/converted";
import { GuardrailsResult } from "../graphql/types/guardrails-result.type";
import { generateHelpfulErrorMessage } from "../lib/streaming";
import telemetry from "../lib/telemetry-client";
import { streamLangChainResponse } from "./langchain/utils";

export enum RuntimeEventTypes {
  TextMessageStart = "TextMessageStart",
  TextMessageContent = "TextMessageContent",
  TextMessageEnd = "TextMessageEnd",
  ActionExecutionStart = "ActionExecutionStart",
  ActionExecutionArgs = "ActionExecutionArgs",
  ActionExecutionEnd = "ActionExecutionEnd",
  ActionExecutionResult = "ActionExecutionResult",
  AgentStateMessage = "AgentStateMessage",
  MetaEvent = "MetaEvent",
  RunError = "RunError",
}

export enum RuntimeMetaEventName {
  LangGraphInterruptEvent = "LangGraphInterruptEvent",
  LangGraphInterruptResumeEvent = "LangGraphInterruptResumeEvent",
  CopilotKitLangGraphInterruptEvent = "CopilotKitLangGraphInterruptEvent",
}

export type RunTimeMetaEvent =
  | {
      type: RuntimeEventTypes.MetaEvent;
      name: RuntimeMetaEventName.LangGraphInterruptEvent;
      value: string;
    }
  | {
      type: RuntimeEventTypes.MetaEvent;
      name: RuntimeMetaEventName.CopilotKitLangGraphInterruptEvent;
      data: { value: string; messages: (TextMessage | ActionExecutionMessage | ResultMessage)[] };
    }
  | {
      type: RuntimeEventTypes.MetaEvent;
      name: RuntimeMetaEventName.LangGraphInterruptResumeEvent;
      data: string;
    };

export type RuntimeErrorEvent = {
  type: RuntimeEventTypes.RunError;
  message: string;
  code?: string;
};

export type RuntimeEvent =
  | { type: RuntimeEventTypes.TextMessageStart; messageId: string; parentMessageId?: string }
  | {
      type: RuntimeEventTypes.TextMessageContent;
      messageId: string;
      content: string;
    }
  | { type: RuntimeEventTypes.TextMessageEnd; messageId: string }
  | {
      type: RuntimeEventTypes.ActionExecutionStart;
      actionExecutionId: string;
      actionName: string;
      parentMessageId?: string;
    }
  | { type: RuntimeEventTypes.ActionExecutionArgs; actionExecutionId: string; args: string }
  | { type: RuntimeEventTypes.ActionExecutionEnd; actionExecutionId: string }
  | {
      type: RuntimeEventTypes.ActionExecutionResult;
      actionName: string;
      actionExecutionId: string;
      result: string;
    }
  | {
      type: RuntimeEventTypes.AgentStateMessage;
      threadId: string;
      agentName: string;
      nodeName: string;
      runId: string;
      active: boolean;
      role: string;
      state: string;
      running: boolean;
    }
  | RunTimeMetaEvent
  | RuntimeErrorEvent;

interface RuntimeEventWithState {
  event: RuntimeEvent | null;
  callActionServerSide: boolean;
  action: Action<any> | null;
  actionExecutionId: string | null;
  args: string;
  actionExecutionParentMessageId: string | null;
}

type EventSourceCallback = (eventStream$: RuntimeEventSubject) => Promise<void>;

export class RuntimeEventSubject extends ReplaySubject<RuntimeEvent> {
  constructor() {
    super();
  }

  sendTextMessageStart({
    messageId,
    parentMessageId,
  }: {
    messageId: string;
    parentMessageId?: string;
  }) {
    this.next({ type: RuntimeEventTypes.TextMessageStart, messageId, parentMessageId });
  }

  sendTextMessageContent({ messageId, content }: { messageId: string; content: string }) {
    this.next({ type: RuntimeEventTypes.TextMessageContent, content, messageId });
  }

  sendTextMessageEnd({ messageId }: { messageId: string }) {
    this.next({ type: RuntimeEventTypes.TextMessageEnd, messageId });
  }

  sendTextMessage(messageId: string, content: string) {
    this.sendTextMessageStart({ messageId });
    this.sendTextMessageContent({ messageId, content });
    this.sendTextMessageEnd({ messageId });
  }

  sendActionExecutionStart({
    actionExecutionId,
    actionName,
    parentMessageId,
  }: {
    actionExecutionId: string;
    actionName: string;
    parentMessageId?: string;
  }) {
    this.next({
      type: RuntimeEventTypes.ActionExecutionStart,
      actionExecutionId,
      actionName,
      parentMessageId,
    });
  }

  sendActionExecutionArgs({
    actionExecutionId,
    args,
  }: {
    actionExecutionId: string;
    args: string;
  }) {
    this.next({ type: RuntimeEventTypes.ActionExecutionArgs, args, actionExecutionId });
  }

  sendActionExecutionEnd({ actionExecutionId }: { actionExecutionId: string }) {
    this.next({ type: RuntimeEventTypes.ActionExecutionEnd, actionExecutionId });
  }

  sendActionExecution({
    actionExecutionId,
    actionName,
    args,
    parentMessageId,
  }: {
    actionExecutionId: string;
    actionName: string;
    args: string;
    parentMessageId?: string;
  }) {
    this.sendActionExecutionStart({ actionExecutionId, actionName, parentMessageId });
    this.sendActionExecutionArgs({ actionExecutionId, args });
    this.sendActionExecutionEnd({ actionExecutionId });
  }

  sendActionExecutionResult({
    actionExecutionId,
    actionName,
    result,
    error,
  }: {
    actionExecutionId: string;
    actionName: string;
    result?: string;
    error?: { code: string; message: string };
  }) {
    this.next({
      type: RuntimeEventTypes.ActionExecutionResult,
      actionName,
      actionExecutionId,
      result: ResultMessage.encodeResult(result, error),
    });
  }

  sendAgentStateMessage({
    threadId,
    agentName,
    nodeName,
    runId,
    active,
    role,
    state,
    running,
  }: {
    threadId: string;
    agentName: string;
    nodeName: string;
    runId: string;
    active: boolean;
    role: string;
    state: string;
    running: boolean;
  }) {
    this.next({
      type: RuntimeEventTypes.AgentStateMessage,
      threadId,
      agentName,
      nodeName,
      runId,
      active,
      role,
      state,
      running,
    });
  }
}

export class RuntimeEventSource {
  private eventStream$ = new RuntimeEventSubject();
  private callback!: EventSourceCallback;
  private errorHandler?: (error: any, context: any) => Promise<void>;
  private errorContext?: any;

  constructor(params?: {
    errorHandler?: (error: any, context: any) => Promise<void>;
    errorContext?: any;
  }) {
    this.errorHandler = params?.errorHandler;
    this.errorContext = params?.errorContext;
  }

  async stream(callback: EventSourceCallback): Promise<void> {
    this.callback = callback;
  }
}

function convertStreamingErrorToStructured(error: any): CopilotKitError {
  // Determine a more helpful error message based on context
  let helpfulMessage = generateHelpfulErrorMessage(error, "event streaming connection");

  // For network-related errors, use CopilotKitLowLevelError to preserve the original error
  if (
    error?.message?.includes("fetch failed") ||
    error?.message?.includes("ECONNREFUSED") ||
    error?.message?.includes("ENOTFOUND") ||
    error?.message?.includes("ETIMEDOUT") ||
    error?.message?.includes("terminated") ||
    error?.cause?.code === "UND_ERR_SOCKET" ||
    error?.message?.includes("other side closed") ||
    error?.code === "UND_ERR_SOCKET"
  ) {
    return new CopilotKitLowLevelError({
      error: error instanceof Error ? error : new Error(String(error)),
      url: "event streaming connection",
      message: helpfulMessage,
    });
  }

  // For all other errors, preserve the raw error in a basic CopilotKitError
  return new CopilotKitError({
    message: helpfulMessage,
    code: CopilotKitErrorCode.UNKNOWN,
    severity: Severity.CRITICAL,
  });
}
