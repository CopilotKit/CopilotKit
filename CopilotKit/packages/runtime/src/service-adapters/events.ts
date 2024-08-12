import { Action } from "@copilotkit/shared";
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
import { LangGraphAgentAction } from "../lib/runtime/remote-actions";

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

type FunctionCallScope = "client" | "server";

export type RuntimeEvent =
  | { type: RuntimeEventTypes.TextMessageStart; messageId: string }
  | {
      type: RuntimeEventTypes.TextMessageContent;
      content: string;
    }
  | { type: RuntimeEventTypes.TextMessageEnd }
  | {
      type: RuntimeEventTypes.ActionExecutionStart;
      actionExecutionId: string;
      actionName: string;
      scope?: FunctionCallScope;
    }
  | { type: RuntimeEventTypes.ActionExecutionArgs; args: string }
  | { type: RuntimeEventTypes.ActionExecutionEnd }
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

  sendTextMessageStart(messageId: string) {
    this.next({ type: RuntimeEventTypes.TextMessageStart, messageId });
  }

  sendTextMessageContent(content: string) {
    this.next({ type: RuntimeEventTypes.TextMessageContent, content });
  }

  sendTextMessageEnd() {
    this.next({ type: RuntimeEventTypes.TextMessageEnd });
  }

  sendTextMessage(messageId: string, content: string) {
    this.sendTextMessageStart(messageId);
    this.sendTextMessageContent(content);
    this.sendTextMessageEnd();
  }

  sendActionExecutionStart(actionExecutionId: string, actionName: string) {
    this.next({
      type: RuntimeEventTypes.ActionExecutionStart,
      actionExecutionId,
      actionName,
    });
  }

  sendActionExecutionArgs(args: string) {
    this.next({ type: RuntimeEventTypes.ActionExecutionArgs, args });
  }

  sendActionExecutionEnd() {
    this.next({ type: RuntimeEventTypes.ActionExecutionEnd });
  }

  sendActionExecution(actionExecutionId: string, toolName: string, args: string) {
    this.sendActionExecutionStart(actionExecutionId, toolName);
    this.sendActionExecutionArgs(args);
    this.sendActionExecutionEnd();
  }

  sendActionExecutionResult(actionExecutionId: string, actionName: string, result: string) {
    this.next({
      type: RuntimeEventTypes.ActionExecutionResult,
      actionName,
      actionExecutionId,
      result,
    });
  }

  sendAgentStateMessage(
    threadId: string,
    agentName: string,
    nodeName: string,
    role: string,
    state: string,
    running: boolean,
  ) {
    this.next({
      type: RuntimeEventTypes.AgentStateMessage,
      threadId,
      agentName,
      nodeName,
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

  process({
    serversideActions,
    guardrailsResult$,
  }: {
    serversideActions: Action<any>[];
    guardrailsResult$?: Subject<GuardrailsResult>;
  }) {
    this.callback(this.eventStream$).catch((error) => {
      console.error("Error in event source callback", error);
    });
    return this.eventStream$.pipe(
      // mark tools for server side execution
      map((event) => {
        if (event.type === RuntimeEventTypes.ActionExecutionStart) {
          event.scope = serversideActions.find((action) => action.name === event.actionName)
            ? "server"
            : "client";
        }
        return event;
      }),
      // track state
      scan(
        (acc, event) => {
          if (event.type === RuntimeEventTypes.ActionExecutionStart) {
            acc.callActionServerSide = event.scope === "server";
            acc.args = "";
            acc.actionExecutionId = event.actionExecutionId;
            if (acc.callActionServerSide) {
              acc.action = serversideActions.find((action) => action.name === event.actionName);
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
    args = JSON.parse(actionArguments);
  }

  // handle LangGraph agents
  if ((action as LangGraphAgentAction).startLangGraphAgentSession) {
    eventStream$.sendActionExecutionResult(
      actionExecutionId,
      action.name,
      `${action.name} agent started`,
    );
    const stream = await (action as LangGraphAgentAction).startLangGraphAgentSession(
      action.name,
      args,
    );

    // forward to eventStream$
    from(stream).subscribe({
      next: (event) => eventStream$.next(event),
      error: (err) => console.error("Error in stream", err),
      complete: () => eventStream$.complete(),
    });
  } else {
    // call the function
    const result = await action.handler(args);

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
