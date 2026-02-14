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
import {
  ActionExecutionMessage,
  ResultMessage,
  TextMessage,
} from "../graphql/types/converted";
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
      data: {
        value: string;
        messages: (TextMessage | ActionExecutionMessage | ResultMessage)[];
      };
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
  | {
      type: RuntimeEventTypes.TextMessageStart;
      messageId: string;
      parentMessageId?: string;
    }
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
  | {
      type: RuntimeEventTypes.ActionExecutionArgs;
      actionExecutionId: string;
      args: string;
    }
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

export type EventSourceCallback = (
  eventStream$: RuntimeEventSubject,
) => Promise<void>;

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
  let helpfulMessage = generateHelpfulErrorMessage(
    error,
    "event streaming connection",
  );

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
