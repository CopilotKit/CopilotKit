import { Action } from "@copilotkit/shared";
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
      toolCallId: string;
      toolName: string;
      scope?: FunctionCallScope;
    }
  | { type: RuntimeEventTypes.ActionExecutionArgs; args: string }
  | { type: RuntimeEventTypes.ActionExecutionEnd }
  | {
      type: RuntimeEventTypes.ActionExecutionResult;
      toolName: string;
      toolCallId: string;
      result: string;
    };

interface RuntimeEventWithState {
  event: RuntimeEvent | null;
  callFunctionServerSide: boolean;
  action: Action<any> | null;
  toolCallId: string | null;
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

  sendActionExecutionStart(actionExecutionId: string, toolName: string) {
    this.next({
      type: RuntimeEventTypes.ActionExecutionStart,
      toolCallId: actionExecutionId,
      toolName,
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

  sendActionExecutionResult(toolCallId: string, toolName: string, result: string) {
    this.next({ type: RuntimeEventTypes.ActionExecutionResult, toolName, toolCallId, result });
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
          event.scope = serversideActions.find((action) => action.name === event.toolName)
            ? "server"
            : "client";
        }
        return event;
      }),
      // track state
      scan(
        (acc, event) => {
          if (event.type === RuntimeEventTypes.ActionExecutionStart) {
            acc.callFunctionServerSide = event.scope === "server";
            acc.args = "";
            acc.toolCallId = event.toolCallId;
            if (acc.callFunctionServerSide) {
              acc.action = serversideActions.find((action) => action.name === event.toolName);
            }
          } else if (event.type === RuntimeEventTypes.ActionExecutionArgs) {
            acc.args += event.args;
          }

          acc.event = event;
          return acc;
        },
        {
          event: null,
          callFunctionServerSide: false,
          args: "",
          toolCallId: null,
          action: null,
        } as RuntimeEventWithState,
      ),
      concatMap((eventWithState) => {
        if (
          eventWithState.event!.type === RuntimeEventTypes.ActionExecutionEnd &&
          eventWithState.callFunctionServerSide
        ) {
          const toolCallEventStream$ = new RuntimeEventSubject();
          executeToolCall(
            toolCallEventStream$,
            eventWithState.action!,
            eventWithState.args,
            eventWithState.toolCallId,
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

async function executeToolCall(
  eventStream$: RuntimeEventSubject,
  action: Action<any>,
  functionCallArguments: string,
  toolCallId: string,
) {
  // Prepare arguments for function calling
  let args: Record<string, any>[] = [];
  if (functionCallArguments) {
    args = JSON.parse(functionCallArguments);
  }

  // call the function
  const result = await action.handler(args);

  // We support several types of return values from functions:

  // 1. string
  // Just send the result as the content of the chunk.
  if (result && typeof result === "string") {
    eventStream$.sendTextMessage(nanoid(), result);
  }

  // 2. AIMessage
  // Send the content and function call of the AIMessage as the content of the chunk.
  else if (result && "content" in result && typeof result.content === "string") {
    if (result.content) {
      eventStream$.sendTextMessage(nanoid(), result.content);
    }
    if (result.additional_kwargs?.tool_calls) {
      for (const toolCall of result.additional_kwargs.tool_calls) {
        eventStream$.sendActionExecution(
          toolCall.id || nanoid(),
          toolCall.function.name || "unknown",
          toolCall.function.arguments || "",
        );
      }
    }
  }

  // 3. BaseMessageChunk
  // Send the content and function call of the AIMessage as the content of the chunk.
  else if (result && "lc_kwargs" in result) {
    if (result.lc_kwargs?.content) {
      eventStream$.sendTextMessage(nanoid(), result.lc_kwargs.content);
    }
    if (result.lc_kwargs?.tool_calls) {
      for (const toolCall of result.lc_kwargs.tool_calls) {
        eventStream$.sendActionExecution(
          toolCall.id || nanoid(),
          toolCall.function.name || "unknown",
          toolCall.function.arguments || "",
        );
      }
    }
  }

  // 4. IterableReadableStream
  // Stream the result of the LangChain function.
  else if (result && "getReader" in result) {
    let reader = result.getReader();

    let mode: "function" | "message" | null = null;

    // TODO-PROTOCOL: this duplicates the openai adapter logic
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
    eventStream$.sendActionExecutionResult(toolCallId, action.name, JSON.stringify(result));
  }
}
