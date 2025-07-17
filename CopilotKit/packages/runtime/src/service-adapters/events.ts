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
import { isRemoteAgentAction } from "../lib/runtime/remote-actions";
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
  | RunTimeMetaEvent;

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

  sendErrorMessageToChat(message = "An error occurred. Please try again.") {
    const errorMessage = `❌ ${message}`;
    if (!this.callback) {
      this.stream(async (eventStream$) => {
        eventStream$.sendTextMessage(randomId(), errorMessage);
      });
    } else {
      this.eventStream$.sendTextMessage(randomId(), errorMessage);
    }
  }

  processRuntimeEvents({
    serverSideActions,
    guardrailsResult$,
    actionInputsWithoutAgents,
    threadId,
  }: {
    serverSideActions: Action<any>[];
    guardrailsResult$?: Subject<GuardrailsResult>;
    actionInputsWithoutAgents: ActionInput[];
    threadId: string;
  }) {
    this.callback(this.eventStream$).catch(async (error) => {
      // Convert streaming errors to structured errors, but preserve already structured ones
      const structuredError = ensureStructuredError(error, convertStreamingErrorToStructured);

      // Call the runtime error handler if provided
      if (this.errorHandler && this.errorContext) {
        try {
          await this.errorHandler(structuredError, this.errorContext);
        } catch (errorHandlerError) {
          console.error("Error in streaming error handler:", errorHandlerError);
        }
      }

      this.eventStream$.error(structuredError);
      this.eventStream$.complete();
    });
    return this.eventStream$.pipe(
      // track state
      scan(
        (acc, event) => {
          // It seems like this is needed so that rxjs recognizes the object has changed
          // This fixes an issue where action were executed multiple times
          // Not investigating further for now (Markus)
          acc = { ...acc };

          if (event.type === RuntimeEventTypes.ActionExecutionStart) {
            acc.callActionServerSide =
              serverSideActions.find((action) => action.name === event.actionName) !== undefined;
            acc.args = "";
            acc.actionExecutionId = event.actionExecutionId;
            if (acc.callActionServerSide) {
              acc.action = serverSideActions.find((action) => action.name === event.actionName);
            }
            acc.actionExecutionParentMessageId = event.parentMessageId;
          } else if (event.type === RuntimeEventTypes.ActionExecutionArgs) {
            acc.args += event.args;
          }

          acc.event = event;

          return acc;
        },
        {
          event: null,
          callActionServerSide: false,
          args: "",
          actionExecutionId: null,
          action: null,
          actionExecutionParentMessageId: null,
        } as RuntimeEventWithState,
      ),
      concatMap((eventWithState) => {
        if (
          eventWithState.event!.type === RuntimeEventTypes.ActionExecutionEnd &&
          eventWithState.callActionServerSide
        ) {
          const toolCallEventStream$ = new RuntimeEventSubject();
          executeAction(
            toolCallEventStream$,
            guardrailsResult$ ? guardrailsResult$ : null,
            eventWithState.action!,
            eventWithState.args,
            eventWithState.actionExecutionParentMessageId,
            eventWithState.actionExecutionId,
            actionInputsWithoutAgents,
            threadId,
          ).catch((error) => {});

          telemetry.capture("oss.runtime.server_action_executed", {});
          return concat(of(eventWithState.event!), toolCallEventStream$).pipe(
            catchError((error) => {
              // Convert streaming errors to structured errors and send as action result, but preserve already structured ones
              const structuredError = ensureStructuredError(
                error,
                convertStreamingErrorToStructured,
              );

              // Call the runtime error handler if provided
              if (this.errorHandler && this.errorContext) {
                // Use from() to handle async error handler
                from(
                  this.errorHandler(structuredError, {
                    ...this.errorContext,
                    action: {
                      name: eventWithState.action!.name,
                      executionId: eventWithState.actionExecutionId,
                    },
                  }),
                ).subscribe({
                  error: (errorHandlerError) => {
                    console.error("Error in action execution error handler:", errorHandlerError);
                  },
                });
              }

              toolCallEventStream$.sendActionExecutionResult({
                actionExecutionId: eventWithState.actionExecutionId!,
                actionName: eventWithState.action!.name,
                error: {
                  code: structuredError.code,
                  message: structuredError.message,
                },
              });

              return EMPTY;
            }),
          );
        } else {
          return of(eventWithState.event!);
        }
      }),
    );
  }
}

async function executeAction(
  eventStream$: RuntimeEventSubject,
  guardrailsResult$: Subject<GuardrailsResult> | null,
  action: Action<any>,
  actionArguments: string,
  actionExecutionParentMessageId: string | null,
  actionExecutionId: string,
  actionInputsWithoutAgents: ActionInput[],
  threadId: string,
) {
  if (guardrailsResult$) {
    const { status } = await firstValueFrom(guardrailsResult$);

    if (status === "denied") {
      eventStream$.complete();
      return;
    }
  }

  // Prepare arguments for function calling
  let args: Record<string, any>[] = [];
  if (actionArguments) {
    try {
      args = JSON.parse(actionArguments);
    } catch (e) {
      console.error("Action argument unparsable", { actionArguments });
      eventStream$.sendActionExecutionResult({
        actionExecutionId,
        actionName: action.name,
        error: {
          code: "INVALID_ARGUMENTS",
          message: "Failed to parse action arguments",
        },
      });
      return;
    }
  }

  // handle LangGraph agents
  if (isRemoteAgentAction(action)) {
    const result = `${action.name} agent started`;

    const agentExecution = plainToInstance(ActionExecutionMessage, {
      id: actionExecutionId,
      createdAt: new Date(),
      name: action.name,
      arguments: JSON.parse(actionArguments),
      parentMessageId: actionExecutionParentMessageId ?? actionExecutionId,
    });

    const agentExecutionResult = plainToInstance(ResultMessage, {
      id: "result-" + actionExecutionId,
      createdAt: new Date(),
      actionExecutionId,
      actionName: action.name,
      result,
    });

    eventStream$.sendActionExecutionResult({
      actionExecutionId,
      actionName: action.name,
      result,
    });

    const stream = await action.remoteAgentHandler({
      name: action.name,
      threadId,
      actionInputsWithoutAgents,
      additionalMessages: [agentExecution, agentExecutionResult],
    });

    // forward to eventStream$
    from(stream).subscribe({
      next: (event) => eventStream$.next(event),
      error: (err) => {
        // Preserve already structured CopilotKit errors, only convert unstructured errors
        const structuredError = ensureStructuredError(err, convertStreamingErrorToStructured);
        eventStream$.sendActionExecutionResult({
          actionExecutionId,
          actionName: action.name,
          error: {
            code: structuredError.code,
            message: structuredError.message,
          },
        });
        eventStream$.complete();
      },
      complete: () => eventStream$.complete(),
    });
  } else {
    // call the function
    try {
      const result = await action.handler?.(args);
      await streamLangChainResponse({
        result,
        eventStream$,
        actionExecution: {
          name: action.name,
          id: actionExecutionId,
        },
      });
    } catch (e) {
      console.error("Error in action handler", e);
      eventStream$.sendActionExecutionResult({
        actionExecutionId,
        actionName: action.name,
        error: {
          code: "HANDLER_ERROR",
          message: e.message,
        },
      });
      eventStream$.complete();
    }
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
