import { Action } from "@copilotkit/shared";
import { nanoid } from "nanoid";
import { of, concat, Subject, map, scan, concatMap } from "rxjs";

export enum RuntimeEventTypes {
  TextMessageStart = "TextMessageStart",
  TextMessageContent = "TextMessageContent",
  TextMessageEnd = "TextMessageEnd",
  ToolCallStart = "ToolCallStart",
  ToolCallArgs = "ToolCallArgs",
  ToolCallEnd = "ToolCallEnd",
  ToolCallResult = "ToolCallResult",
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
      type: RuntimeEventTypes.ToolCallStart;
      toolCallId: string;
      toolName: string;
      scope?: FunctionCallScope;
    }
  | { type: RuntimeEventTypes.ToolCallArgs; args: string }
  | { type: RuntimeEventTypes.ToolCallEnd }
  | {
      type: RuntimeEventTypes.ToolCallResult;
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

  sendToolCallStart(toolCallId: string, toolName: string) {
    this.next({ type: RuntimeEventTypes.ToolCallStart, toolCallId, toolName });
  }

  sendToolCallArgs(args: string) {
    this.next({ type: RuntimeEventTypes.ToolCallArgs, args });
  }

  sendToolCallEnd() {
    this.next({ type: RuntimeEventTypes.ToolCallEnd });
  }

  sendToolCall(toolCallId: string, toolName: string, args: string) {
    this.sendToolCallStart(toolCallId, toolName);
    this.sendToolCallArgs(args);
    this.sendToolCallEnd();
  }

  sendToolCallResult(toolCallId: string, toolName: string, result: string) {
    this.next({ type: RuntimeEventTypes.ToolCallResult, toolName, toolCallId, result });
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
        if (event.type === RuntimeEventTypes.ToolCallStart) {
          event.scope = serversideActions.find((action) => action.name === event.toolName)
            ? "server"
            : "client";
        }
        return event;
      }),
      // track state
      scan(
        (acc, event) => {
          if (event.type === RuntimeEventTypes.ToolCallStart) {
            acc.callFunctionServerSide = event.scope === "server";
            acc.args = "";
            acc.toolCallId = event.toolCallId;
            if (acc.callFunctionServerSide) {
              acc.action = serversideActions.find((action) => action.name === event.toolName);
            }
          } else if (event.type === RuntimeEventTypes.ToolCallArgs) {
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
          eventWithState.event!.type === RuntimeEventTypes.ToolCallEnd &&
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
        eventStream$.sendToolCall(
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
        eventStream$.sendToolCall(
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
          eventStream$.sendToolCallEnd();
        }

        if (done) {
          break;
        }

        // If we send a new message type, send the appropriate start event.
        if (mode === null) {
          if (toolCall.function) {
            mode = "function";
            eventStream$.sendToolCallStart(toolCall.id, toolCall.function!.name);
          } else if (content) {
            mode = "message";
            eventStream$.sendTextMessageStart(nanoid());
          }
        }

        // send the content events
        if (mode === "message" && content) {
          eventStream$.sendTextMessageContent(content);
        } else if (mode === "function" && toolCall.function?.arguments) {
          eventStream$.sendToolCallArgs(toolCall.function.arguments);
        }
      } catch (error) {
        console.error("Error reading from stream", error);
        break;
      }
    }
  }

  // 5. Any other type, return JSON result
  else {
    eventStream$.sendToolCallResult(toolCallId, action.name, JSON.stringify(result));
  }
}
