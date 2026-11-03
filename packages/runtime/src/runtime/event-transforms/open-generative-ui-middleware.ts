import type {
  RunAgentInput,
  AbstractAgent,
  BaseEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ActivitySnapshotEventProps,
  ActivityDeltaEvent,
} from "@ag-ui/client";
import { Middleware, EventType } from "@ag-ui/client";
import { Observable } from "rxjs";
import { StreamingJsonScanner } from "./streaming-json-scanner";
import type { JsonScalar } from "./streaming-json-scanner";

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
  private readonly scanner: StreamingJsonScanner;
  private currentKey: string | null = null;
  private depth = 0;
  private currentArrayKey: string | null = null;
  private snapshotEmitted = false;

  // Streaming html state. flushHtmlChunks reads scanner.partialString to emit
  // the html in chunks while it streams in.
  private streamingHtmlKey = false;
  private htmlEmittedLength = 0;
  private htmlArrayEmitted = false;

  public readonly params: GenerateSandboxedUIParams = {};
  public readonly messageId: string;
  private readonly onEvent: OnParamEvent;

  constructor(toolCallId: string, onEvent: OnParamEvent) {
    this.messageId = `${toolCallId}-activity`;
    this.onEvent = onEvent;
    // The scanner skips bad characters and warns by itself, so no error
    // handler is needed here.
    this.scanner = new StreamingJsonScanner({
      onOpenObject: () => {
        this.depth++;
      },

      onKey: (key) => {
        if (this.depth === 1) {
          this.currentKey = key;
          this.initHtmlStreaming(key);
        }
      },

      onValue: (value) => {
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
            // The html string is complete. Emit the rest of it now, then htmlComplete.
            const fullHtml = value != null ? String(value) : "";
            this.params.html = fullHtml || undefined;
            this.emitPendingHtml(fullHtml);
            this.emitParamDelta("htmlComplete", true);
            this.streamingHtmlKey = false;
          } else {
            this.setParam(this.currentKey, value);
          }
        }
      },

      onOpenArray: () => {
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
      },

      onCloseArray: () => {
        if (this.depth === 1) {
          if (this.currentArrayKey === "jsExpressions") {
            this.emitParamDelta("jsExpressionsComplete", true);
          }
          this.currentArrayKey = null;
        }
      },

      onCloseObject: () => {
        this.depth--;
      },
    });
  }

  write(chunk: string) {
    this.scanner.write(chunk);
    this.flushHtmlChunks();
  }

  private initHtmlStreaming(key: string) {
    if (key === "html") {
      this.streamingHtmlKey = true;
      this.htmlEmittedLength = 0;
      this.htmlArrayEmitted = false;
    }
  }

  /**
   * Emit the html read so far while the html string streams in.
   * Called after every write(). It reads only while the top-level `html`
   * value is being read, so a nested string is never emitted as html.
   */
  private flushHtmlChunks() {
    if (!this.streamingHtmlKey || this.depth !== 1) return;
    const partialHtml = this.scanner.partialString;
    if (partialHtml === undefined) return;
    if (partialHtml.length === this.htmlEmittedLength) return;

    this.emitPendingHtml(partialHtml);
  }

  /**
   * Emit accumulated html content since the last emission.
   * Called by flushHtmlChunks and directly when html completes.
   */
  private emitPendingHtml(html: string) {
    const newContent = html.slice(this.htmlEmittedLength);
    if (newContent.length === 0) return;

    if (!this.htmlArrayEmitted) {
      this.htmlArrayEmitted = true;
      this.emitParamDelta("html", []);
    }
    this.emitArrayItemDelta("html", newContent);
    this.htmlEmittedLength = html.length;
  }

  private setParam(key: string, value: JsonScalar) {
    switch (key) {
      case "initialHeight":
        this.params.initialHeight =
          typeof value === "number" ? value : undefined;
        if (this.snapshotEmitted) {
          // Snapshot already went out (another param parsed first) — deliver
          // the height as a delta instead.
          this.emitParamDelta("initialHeight", this.params.initialHeight);
        } else {
          this.emitSnapshot();
        }
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

  private emitSnapshot() {
    if (this.snapshotEmitted) return;
    this.snapshotEmitted = true;

    const event = {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: this.messageId,
      activityType: ACTIVITY_TYPE,
      content: { initialHeight: this.params.initialHeight, generating: true },
    } satisfies ActivitySnapshotEventProps;
    this.onEvent(event);
  }

  private emitParamDelta(key: string, value: unknown) {
    // A JSON Patch "add" requires a value; emitting one without it (e.g. when
    // the LLM sends a null/empty jsFunctions or css) makes fast-json-patch
    // reject the whole patch client-side with OPERATION_VALUE_REQUIRED and
    // drops it. Skip the delta when there's nothing to add.
    if (value === undefined) return;
    // The activity message must exist before any delta can be applied —
    // the client silently drops ACTIVITY_DELTA events whose messageId has
    // no prior ACTIVITY_SNAPSHOT. The LLM controls the key order of the
    // streamed args, so the snapshot cannot wait for initialHeight.
    this.emitSnapshot();
    const event: ActivityDeltaEvent = {
      type: EventType.ACTIVITY_DELTA,
      messageId: this.messageId,
      activityType: ACTIVITY_TYPE,
      patch: [{ op: "add", path: `/${key}`, value }],
    };
    this.onEvent(event);
  }

  private emitArrayItemDelta(arrayKey: string, value: string) {
    this.emitSnapshot();
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
