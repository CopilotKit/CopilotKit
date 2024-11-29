import { Action, randomId } from "@copilotkit/shared";
import {
  of,
  concat,
  map,
  scan,
  concatMap,
  ReplaySubject,
  Subject,
  firstValueFrom,
  from,
} from "rxjs";
import { streamLangChainResponse } from "./langchain/utils";
import { GuardrailsResult } from "../graphql/types/guardrails-result.type";
import telemetry from "../lib/telemetry-client";
import { isLangGraphAgentAction } from "../lib/runtime/remote-actions";
import { ActionInput } from "../graphql/inputs/action.input";

export enum RuntimeEventTypes {
  TextMessageStart = "TextMessageStart",
  TextMessageContent = "TextMessageContent",
  TextMessageEnd = "TextMessageEnd",
  ActionExecutionStart = "ActionExecutionStart",
  ActionExecutionArgs = "ActionExecutionArgs",
  ActionExecutionEnd = "ActionExecutionEnd",
  ActionExecutionResult = "ActionExecutionResult",
  AgentStateMessage = "AgentStateMessage",
}

type FunctionCallScope = "client" | "server" | "passThrough";

export type RuntimeEvent =
  | { type: RuntimeEventTypes.TextMessageStart; messageId: string }
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
      scope?: FunctionCallScope;
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
    };

interface RuntimeEventWithState {
  event: RuntimeEvent | null;
  callActionServerSide: boolean;
  action: Action<any> | null;
  actionExecutionId: string | null;
  args: string;
}

type EventSourceCallback = (eventStream$: RuntimeEventSubject) => Promise<void>;

export class RuntimeEventSubject extends ReplaySubject<RuntimeEvent> {
  constructor() {
    super();
  }

  sendTextMessageStart({ messageId }: { messageId: string }) {
    this.next({ type: RuntimeEventTypes.TextMessageStart, messageId });
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
  }: {
    actionExecutionId: string;
    actionName: string;
  }) {
    this.next({
      type: RuntimeEventTypes.ActionExecutionStart,
      actionExecutionId,
      actionName,
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
  }: {
    actionExecutionId: string;
    actionName: string;
    args: string;
  }) {
    this.sendActionExecutionStart({ actionExecutionId, actionName });
    this.sendActionExecutionArgs({ actionExecutionId, args });
    this.sendActionExecutionEnd({ actionExecutionId });
  }

  sendActionExecutionResult({
    actionExecutionId,
    actionName,
    result,
  }: {
    actionExecutionId: string;
    actionName: string;
    result: string;
  }) {
    this.next({
      type: RuntimeEventTypes.ActionExecutionResult,
      actionName,
      actionExecutionId,
      result,
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

  async stream(callback: EventSourceCallback): Promise<void> {
    this.callback = callback;
  }

  sendErrorMessageToChat() {
    const errorMessage = "❌ An error occurred. Please try again.";
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
  }: {
    serverSideActions: Action<any>[];
    guardrailsResult$?: Subject<GuardrailsResult>;
    actionInputsWithoutAgents: ActionInput[];
  }) {
    this.callback(this.eventStream$).catch((error) => {
      console.error("Error in event source callback", error);
      this.sendErrorMessageToChat();
    });
    return this.eventStream$.pipe(
      // mark tools for server side execution
      map((event) => {
        if (event.type === RuntimeEventTypes.ActionExecutionStart) {
          if (event.scope !== "passThrough") {
            event.scope = serverSideActions.find((action) => action.name === event.actionName)
              ? "server"
              : "client";
          }
        }
        return event;
      }),
      // track state
      scan(
        (acc, event) => {
          // It seems like this is needed so that rxjs recognizes the object has changed
          // This fixes an issue where action were executed multiple times
          // Not investigating further for now (Markus)
          acc = { ...acc };

          if (event.type === RuntimeEventTypes.ActionExecutionStart) {
            acc.callActionServerSide = event.scope === "server";
            acc.args = "";
            acc.actionExecutionId = event.actionExecutionId;
            if (acc.callActionServerSide) {
              acc.action = serverSideActions.find((action) => action.name === event.actionName);
            }
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
            eventWithState.actionExecutionId,
            actionInputsWithoutAgents,
          ).catch((error) => {
            console.error(error);
          });

          telemetry.capture("oss.runtime.server_action_executed", {});
          return concat(of(eventWithState.event!), toolCallEventStream$);
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
  actionExecutionId: string,
  actionInputsWithoutAgents: ActionInput[],
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
      console.warn("Action argument unparsable", { actionArguments });
    }
  }

  // handle LangGraph agents
  if (isLangGraphAgentAction(action)) {
    eventStream$.sendActionExecutionResult({
      actionExecutionId,
      actionName: action.name,
      result: `${action.name} agent started`,
    });
    const stream = await action.langGraphAgentHandler({
      name: action.name,
      actionInputsWithoutAgents,
    });

    // forward to eventStream$
    from(stream).subscribe({
      next: (event) => eventStream$.next(event),
      error: (err) => console.error("Error in stream", err),
      complete: () => eventStream$.complete(),
    });
  } else {
    // call the function
    const result = await action.handler?.(args);

    await streamLangChainResponse({
      result,
      eventStream$,
      actionExecution: {
        name: action.name,
        id: actionExecutionId,
      },
    });
  }
}
