import { randomUUID } from "node:crypto";
import {
  Middleware,
  RunAgentInput,
  AbstractAgent,
  BaseEvent,
  EventType,
  Message,
  ToolCall,
  ToolCallResultEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ActivitySnapshotEvent,
  ActivityDeltaEvent,
  Tool,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import * as clarinet from "clarinet";

const TOOL_NAME = "generateSandboxedUi";
const ACTIVITY_TYPE = "open-generative-ui";

const GENERATE_SANDBOXED_UI_TOOL: Tool = {
  name: TOOL_NAME,
  description: "Generate sandboxed UI",
  parameters: {
    type: "object",
    properties: {
      initialHeight: {
        type: "number",
        description: "Fixed height of the UI container in pixels",
      },
      html: {
        type: "string",
        description:
          "HTML markup for the UI. Must be a complete HTML document including <head> and <body> tags.",
      },
      jsFunctions: {
        type: "string",
        description: "A chunk of reusable JS functions",
      },
      jsExpressions: {
        type: "array",
        items: { type: "string" },
        description:
          "Array of JS expressions executed sequentially to iteratively build the UI",
      },
    },
  },
};

/**
 * Parsed parameters from the generateSandboxedUi tool call.
 */
export interface GenerateSandboxedUIParams {
  initialHeight?: number;
  html?: string;
  jsFunctions?: string;
  jsExpressions?: string[];
}

/**
 * Callback invoked by ArgsParser whenever a parameter (or array item) finishes parsing.
 */
export type OnParamEvent = (event: BaseEvent) => void;

/**
 * Tracks incremental JSON parsing state for a single tool call's arguments.
 * Emits activity events via the onEvent callback as parameters complete.
 */
export class ArgsParser {
  private parser: ReturnType<typeof clarinet.parser>;
  private currentKey: string | null = null;
  private depth = 0;
  private inArray = false;
  private snapshotEmitted = false;

  public readonly params: GenerateSandboxedUIParams = {};
  private readonly messageId: string;
  private readonly onEvent: OnParamEvent;

  constructor(toolCallId: string, onEvent: OnParamEvent) {
    this.messageId = `${toolCallId}-activity`;
    this.onEvent = onEvent;
    this.parser = clarinet.parser();

    this.parser.onopenobject = (key: string | undefined) => {
      this.depth++;
      if (key !== undefined && this.depth === 1) {
        this.currentKey = key;
      }
    };

    this.parser.onkey = (key: string) => {
      if (this.depth === 1) {
        this.currentKey = key;
      }
    };

    this.parser.onvalue = (value: string | boolean | number | null) => {
      if (this.depth === 1 && this.currentKey) {
        if (this.inArray && this.currentKey === "jsExpressions") {
          if (!this.params.jsExpressions) {
            this.params.jsExpressions = [];
          }
          const strValue = String(value);
          this.params.jsExpressions.push(strValue);
          this.emitArrayItemDelta(strValue);
        } else {
          this.setParam(this.currentKey, value);
        }
      }
    };

    this.parser.onopenarray = () => {
      if (this.depth === 1 && this.currentKey === "jsExpressions") {
        this.inArray = true;
        this.params.jsExpressions = [];
        // Emit a delta to create the array in the activity content.
        // Subsequent "add" ops with path "/jsExpressions/-" append to this array.
        this.emitParamDelta("jsExpressions", []);
      }
    };

    this.parser.onclosearray = () => {
      if (this.depth === 1) {
        this.inArray = false;
      }
    };

    this.parser.oncloseobject = () => {
      this.depth--;
    };

    this.parser.onerror = () => {
      // Reset error state so parsing can continue with the next chunk
      this.parser.error = null;
      this.parser.resume();
    };
  }

  write(chunk: string): void {
    this.parser.write(chunk);
  }

  private setParam(key: string, value: string | boolean | number | null): void {
    switch (key) {
      case "initialHeight":
        this.params.initialHeight = typeof value === "number" ? value : undefined;
        this.emitSnapshot();
        break;
      case "html":
        this.params.html = value != null ? String(value) : undefined;
        this.emitParamDelta("html", this.params.html);
        break;
      case "jsFunctions":
        this.params.jsFunctions = value != null ? String(value) : undefined;
        this.emitParamDelta("jsFunctions", this.params.jsFunctions);
        break;
    }
  }

  private emitSnapshot(): void {
    if (this.snapshotEmitted) return;
    this.snapshotEmitted = true;

    const event: ActivitySnapshotEvent = {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: this.messageId,
      activityType: ACTIVITY_TYPE,
      content: { initialHeight: this.params.initialHeight },
    };
    this.onEvent(event);
  }

  private emitParamDelta(key: string, value: unknown): void {
    const event: ActivityDeltaEvent = {
      type: EventType.ACTIVITY_DELTA,
      messageId: this.messageId,
      activityType: ACTIVITY_TYPE,
      patch: [{ op: "add", path: `/${key}`, value }],
    };
    this.onEvent(event);
  }

  private emitArrayItemDelta(value: string): void {
    const event: ActivityDeltaEvent = {
      type: EventType.ACTIVITY_DELTA,
      messageId: this.messageId,
      activityType: ACTIVITY_TYPE,
      patch: [{ op: "add", path: "/jsExpressions/-", value }],
    };
    this.onEvent(event);
  }
}

/**
 * Extract EventWithState type from Middleware.runNextWithState return type
 */
type ExtractObservableType<T> = T extends Observable<infer U> ? U : never;
type RunNextWithStateReturn = ReturnType<Middleware["runNextWithState"]>;
type EventWithState = ExtractObservableType<RunNextWithStateReturn>;

export class OpenGenerativeUIMiddleware extends Middleware {
  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    const enhancedInput = this.injectTool(input);
    return this.processStream(this.runNextWithState(enhancedInput, next));
  }

  private injectTool(input: RunAgentInput): RunAgentInput {
    const filteredTools = input.tools.filter((t) => t.name !== TOOL_NAME);
    return {
      ...input,
      tools: [...filteredTools, GENERATE_SANDBOXED_UI_TOOL],
    };
  }

  private processStream(source: Observable<EventWithState>): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      let heldRunFinished: EventWithState | null = null;
      // Track active generateSandboxedUi tool call IDs → their streaming parser
      const activeParsers = new Map<string, ArgsParser>();
      // Hold genui tool call events until the first activity event is emitted
      const heldToolCallEvents = new Map<string, BaseEvent[]>();
      const flushedToolCalls = new Set<string>();

      const flushHeldEvents = (toolCallId: string) => {
        if (flushedToolCalls.has(toolCallId)) return;
        flushedToolCalls.add(toolCallId);
        const held = heldToolCallEvents.get(toolCallId);
        if (held) {
          for (const e of held) {
            subscriber.next(e);
          }
          heldToolCallEvents.delete(toolCallId);
        }
      };

      const subscription = source.subscribe({
        next: (eventWithState) => {
          const event = eventWithState.event;

          if (heldRunFinished) {
            subscriber.next(heldRunFinished.event);
            heldRunFinished = null;
          }

          if (event.type === EventType.RUN_FINISHED) {
            heldRunFinished = eventWithState;
            return;
          }

          // Hold TOOL_CALL_START for genui until the first activity event
          if (event.type === EventType.TOOL_CALL_START) {
            const startEvent = event as ToolCallStartEvent;
            if (startEvent.toolCallName === TOOL_NAME) {
              heldToolCallEvents.set(startEvent.toolCallId, [event]);
              activeParsers.set(
                startEvent.toolCallId,
                new ArgsParser(startEvent.toolCallId, (activityEvent) => {
                  subscriber.next(activityEvent);
                  flushHeldEvents(startEvent.toolCallId);
                }),
              );
              return;
            }
          }

          // Hold or emit TOOL_CALL_ARGS for genui tool calls
          if (event.type === EventType.TOOL_CALL_ARGS) {
            const argsEvent = event as ToolCallArgsEvent;
            const parser = activeParsers.get(argsEvent.toolCallId);
            if (parser) {
              if (!flushedToolCalls.has(argsEvent.toolCallId)) {
                heldToolCallEvents.get(argsEvent.toolCallId)!.push(event);
              } else {
                subscriber.next(event);
              }
              parser.write(argsEvent.delta);
              return;
            }
          }

          // Hold or emit TOOL_CALL_END for genui tool calls
          if (event.type === EventType.TOOL_CALL_END) {
            const endEvent = event as { toolCallId: string } & BaseEvent;
            if (activeParsers.has(endEvent.toolCallId)) {
              if (!flushedToolCalls.has(endEvent.toolCallId)) {
                heldToolCallEvents.get(endEvent.toolCallId)!.push(event);
              } else {
                subscriber.next(event);
              }
              return;
            }
          }

          subscriber.next(event);
        },
        error: (err) => {
          if (heldRunFinished) {
            subscriber.next(heldRunFinished.event);
            heldRunFinished = null;
          }
          subscriber.error(err);
        },
        complete: () => {
          // Flush any remaining held tool call events (e.g. parser never emitted)
          heldToolCallEvents.forEach((_, toolCallId) => {
            flushHeldEvents(toolCallId);
          });

          if (heldRunFinished) {
            const pendingToolCalls = this.findPendingToolCalls(heldRunFinished.messages);
            const pendingGenUICalls = pendingToolCalls.filter(
              (tc) => tc.function.name === TOOL_NAME,
            );

            for (const toolCall of pendingGenUICalls) {
              const resultEvent: ToolCallResultEvent = {
                type: EventType.TOOL_CALL_RESULT,
                messageId: randomUUID(),
                toolCallId: toolCall.id,
                content: "UI generated",
              };
              subscriber.next(resultEvent);
            }

            subscriber.next(heldRunFinished.event);
            heldRunFinished = null;
          }
          activeParsers.clear();
          subscriber.complete();
        },
      });

      return () => subscription.unsubscribe();
    });
  }

  private findPendingToolCalls(messages: Message[]): ToolCall[] {
    const allToolCalls: ToolCall[] = [];
    for (const message of messages) {
      if (
        message.role === "assistant" &&
        "toolCalls" in message &&
        message.toolCalls
      ) {
        allToolCalls.push(...message.toolCalls);
      }
    }

    const resolvedToolCallIds = new Set<string>();
    for (const message of messages) {
      if (message.role === "tool" && "toolCallId" in message) {
        resolvedToolCallIds.add(message.toolCallId);
      }
    }

    return allToolCalls.filter((tc) => !resolvedToolCallIds.has(tc.id));
  }
}
