import { Action } from "@copilotkit/shared";
import { AIMessage, BaseMessageChunk } from "@langchain/core/messages";
import { nanoid } from "nanoid";
import { of, concat, Subject, map, scan, concatMap } from "rxjs";

export enum RuntimeEventTypes {
  TextMessageStart = "TextMessageStart",
  TextMessageContent = "TextMessageContent",
  TextMessageEnd = "TextMessageEnd",
  ActionExecutionStart = "ActionExecutionStart",
  ActionExecutionArgs = "ActionExecutionArgs",
  ActionExecutionEnd = "ActionExecutionEnd",
  ActionExecutionResult = "ActionExecutionResult",
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
    };

interface RuntimeEventWithState {
  event: RuntimeEvent | null;
  callActionServerSide: boolean;
  action: Action<any> | null;
  actionExecutionId: string | null;
  args: string;
}

type EventSourceCallback = (eventStream$: RuntimeEventSubject) => Promise<void>;

class RuntimeEventSubject extends Subject<RuntimeEvent> {
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
}

export class RuntimeEventSource {
  private eventStream$ = new RuntimeEventSubject();
  private callback!: EventSourceCallback;

  async stream(callback: EventSourceCallback): Promise<void> {
    this.callback = callback;
  }

  process(serversideActions: Action<any>[]) {
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
            eventWithState.action!,
            eventWithState.args,
            eventWithState.actionExecutionId,
          ).catch((error) => {
            console.error(error);
          });
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
  action: Action<any>,
  actionArguments: string,
  actionExecutionId: string,
) {
  // Prepare arguments for function calling
  let args: Record<string, any>[] = [];
  if (actionArguments) {
    args = JSON.parse(actionArguments);
  }

  // call the function
  const result = await action.handler(args);

  // We support several types of return values from functions:

  // 1. string
  // Just send the result as the content of the chunk.
  if (result && typeof result === "string") {
    eventStream$.sendActionExecutionResult(actionExecutionId, action.name, result);
  }

  // 2. AIMessage
  // Send the content and function call of the AIMessage as the content of the chunk.
  else if (result instanceof AIMessage) {
    if (result.content) {
      eventStream$.sendTextMessage(nanoid(), result.content as string);
    }
    for (const toolCall of result.tool_calls) {
      eventStream$.sendActionExecution(
        toolCall.id || nanoid(),
        toolCall.name,
        JSON.stringify(toolCall.args),
      );
    }
  }

  // 3. BaseMessageChunk
  // Send the content and function call of the AIMessage as the content of the chunk.
  else if (result instanceof BaseMessageChunk) {
    if (result.lc_kwargs?.content) {
      eventStream$.sendTextMessage(nanoid(), result.content as string);
    }
    if (result.lc_kwargs?.tool_calls) {
      for (const toolCall of result.lc_kwargs?.tool_calls) {
        eventStream$.sendActionExecution(
          toolCall.id || nanoid(),
          toolCall.name,
          JSON.stringify(toolCall.args),
        );
      }
    }
  }

  // 4. IterableReadableStream
  // Stream the result of the LangChain function.
  else if (result && "getReader" in result) {
    let reader = result.getReader();

    let mode: "function" | "message" | null = null;

    while (true) {
      try {
        const { done, value } = await reader.read();

        const toolCall = value.lc_kwargs?.additional_kwargs?.tool_calls?.[0];
        const content = value?.lc_kwargs?.content;

        // When switching from message to function or vice versa,
        // or when we are done, send the respective end event.
        if (mode === "message" && (toolCall.function || done)) {
          mode = null;
          eventStream$.sendTextMessageEnd();
        } else if (mode === "function" && (!toolCall.function || done)) {
          mode = null;
          eventStream$.sendActionExecutionEnd();
        }

        if (done) {
          break;
        }

        // If we send a new message type, send the appropriate start event.
        if (mode === null) {
          if (toolCall.function) {
            mode = "function";
            eventStream$.sendActionExecutionStart(toolCall.id, toolCall.function!.name);
          } else if (content) {
            mode = "message";
            eventStream$.sendTextMessageStart(nanoid());
          }
        }

        // send the content events
        if (mode === "message" && content) {
          eventStream$.sendTextMessageContent(content);
        } else if (mode === "function" && toolCall.function?.arguments) {
          eventStream$.sendActionExecutionArgs(toolCall.function.arguments);
        }
      } catch (error) {
        console.error("Error reading from stream", error);
        break;
      }
    }
  }

  // 5. Any other type, return JSON result
  else {
    eventStream$.sendActionExecutionResult(actionExecutionId, action.name, JSON.stringify(result));
  }

  eventStream$.complete();
}
