import {
  Middleware,
  RunAgentInput,
  AbstractAgent,
  BaseEvent,
  EventType,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ActivitySnapshotEvent,
  ActivityDeltaEvent,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import clarinet from "clarinet";

const TOOL_NAME = "generateSandboxedUi";
const ACTIVITY_TYPE = "open-generative-ui";

/**
 * Parsed parameters from the generateSandboxedUi tool call.
 */
export interface GenerateSandboxedUIParams {
  initialHeight?: number;
  placeholderMessages?: string[];
  css?: string;
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
  private currentArrayKey: string | null = null;
  private snapshotEmitted = false;

  // Streaming html state — reads parser.textNode to emit incremental chunks
  private streamingHtmlKey = false;
  private htmlEmittedLength = 0;
  private htmlArrayEmitted = false;

  public readonly params: GenerateSandboxedUIParams = {};
  public readonly messageId: string;
  private readonly onEvent: OnParamEvent;

  constructor(toolCallId: string, onEvent: OnParamEvent) {
    this.messageId = `${toolCallId}-activity`;
    this.onEvent = onEvent;
    this.parser = clarinet.parser();

    this.parser.onopenobject = (key: string | undefined) => {
      this.depth++;
      if (key !== undefined && this.depth === 1) {
        this.currentKey = key;
        this.initHtmlStreaming(key);
      }
    };

    this.parser.onkey = (key: string) => {
      if (this.depth === 1) {
        this.currentKey = key;
        this.initHtmlStreaming(key);
      }
    };

    this.parser.onvalue = (value: string | boolean | number | null) => {
      if (this.depth === 1 && this.currentKey) {
        if (this.currentArrayKey) {
          const strValue = String(value);
          if (this.currentArrayKey === "jsExpressions") {
            if (!this.params.jsExpressions) this.params.jsExpressions = [];
            this.params.jsExpressions.push(strValue);
          } else if (this.currentArrayKey === "placeholderMessages") {
            if (!this.params.placeholderMessages)
              this.params.placeholderMessages = [];
            this.params.placeholderMessages.push(strValue);
          }
          this.emitArrayItemDelta(this.currentArrayKey, strValue);
        } else if (this.streamingHtmlKey) {
          // HTML string completed — flush any remaining content immediately + htmlComplete
          const fullHtml = value != null ? String(value) : "";
          this.params.html = fullHtml || undefined;
          this.emitPendingHtml(fullHtml);
          this.emitParamDelta("htmlComplete", true);
          this.streamingHtmlKey = false;
        } else {
          this.setParam(this.currentKey, value);
        }
      }
    };

    this.parser.onopenarray = () => {
      if (this.depth === 1 && this.currentKey) {
        const key = this.currentKey;
        if (key === "jsExpressions" || key === "placeholderMessages") {
          this.currentArrayKey = key;
          if (key === "jsExpressions") this.params.jsExpressions = [];
          else this.params.placeholderMessages = [];
          // Emit a delta to create the array in the activity content.
          // Subsequent "add" ops with path "/<key>/-" append to this array.
          this.emitParamDelta(key, []);
        }
      }
    };

    this.parser.onclosearray = () => {
      if (this.depth === 1) {
        if (this.currentArrayKey === "jsExpressions") {
          this.emitParamDelta("jsExpressionsComplete", true);
        }
        this.currentArrayKey = null;
      }
    };

    this.parser.oncloseobject = () => {
      this.depth--;
    };

    this.parser.onerror = (err: Error) => {
      console.warn(
        "[OpenGenerativeUI] JSON parse error in streaming args, resuming:",
        err?.message ?? err,
      );
      // Reset error state so parsing can continue with the next chunk
      this.parser.error = null;
      this.parser.resume();
    };
  }

  write(chunk: string): void {
    this.parser.write(chunk);
    this.flushHtmlChunks();
  }

  private initHtmlStreaming(key: string): void {
    if (key === "html") {
      this.streamingHtmlKey = true;
      this.htmlEmittedLength = 0;
      this.htmlArrayEmitted = false;
    }
  }

  /**
   * Read clarinet's internal textNode buffer to emit html chunks incrementally.
   * Called after every write() so partial string content is emitted as it streams in.
   */
  private flushHtmlChunks(): void {
    if (!this.streamingHtmlKey) return;
    const textNode = (this.parser as any).textNode;
    if (typeof textNode !== "string") return;
    if (textNode.length === this.htmlEmittedLength) return;

    this.emitPendingHtml(textNode);
  }

  /**
   * Emit accumulated html content since the last emission.
   * Called by flushHtmlChunks and directly when html completes.
   */
  private emitPendingHtml(textNode: string): void {
    const newContent = textNode.slice(this.htmlEmittedLength);
    if (newContent.length === 0) return;

    if (!this.htmlArrayEmitted) {
      this.htmlArrayEmitted = true;
      this.emitParamDelta("html", []);
    }
    this.emitArrayItemDelta("html", newContent);
    this.htmlEmittedLength = textNode.length;
  }

  private setParam(key: string, value: string | boolean | number | null): void {
    switch (key) {
      case "initialHeight":
        this.params.initialHeight =
          typeof value === "number" ? value : undefined;
        this.emitSnapshot();
        break;
      case "css":
        this.params.css = value != null ? String(value) : undefined;
        this.emitParamDelta("css", this.params.css);
        this.emitParamDelta("cssComplete", true);
        break;
      case "jsFunctions":
        this.params.jsFunctions = value != null ? String(value) : undefined;
        this.emitParamDelta("jsFunctions", this.params.jsFunctions);
        this.emitParamDelta("jsFunctionsComplete", true);
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
      content: { initialHeight: this.params.initialHeight, generating: true },
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

  private emitArrayItemDelta(arrayKey: string, value: string): void {
    const event: ActivityDeltaEvent = {
      type: EventType.ACTIVITY_DELTA,
      messageId: this.messageId,
      activityType: ACTIVITY_TYPE,
      patch: [{ op: "add", path: `/${arrayKey}/-`, value }],
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
    return this.processStream(this.runNextWithState(input, next));
  }

  private processStream(
    source: Observable<EventWithState>,
  ): Observable<BaseEvent> {
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
            const parser = activeParsers.get(endEvent.toolCallId);
            if (parser) {
              // Mark generation complete
              const completeEvent: ActivityDeltaEvent = {
                type: EventType.ACTIVITY_DELTA,
                messageId: parser.messageId,
                activityType: ACTIVITY_TYPE,
                patch: [{ op: "add", path: "/generating", value: false }],
              };
              subscriber.next(completeEvent);

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
          // Flush any held tool call events so downstream sees them before the error
          for (const [, events] of heldToolCallEvents) {
            for (const event of events) {
              subscriber.next(event);
            }
          }
          heldToolCallEvents.clear();

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
}
