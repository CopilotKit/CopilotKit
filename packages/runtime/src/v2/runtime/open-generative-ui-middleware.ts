import type {
  ActivityMessage,
  AssistantMessage,
  ToolCall,
  Message,
  MessagesSnapshotEvent,
  ToolMessage,
} from "@ag-ui/client";
import { map } from "rxjs/operators";
import type {
  RunAgentInput,
  AbstractAgent,
  BaseEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallResultEvent,
  ActivitySnapshotEvent,
  ActivityDeltaEvent,
} from "@ag-ui/client";
import { Middleware, EventType } from "@ag-ui/client";
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
  private content: Record<string, unknown> = { generating: true };

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

  /** The presentation already emitted by this parser, including partial HTML. */
  activity(): ActivityMessage {
    return {
      id: this.messageId,
      role: "activity",
      activityType: ACTIVITY_TYPE,
      content: this.content,
    };
  }

  finish(): void {
    this.emitParamDelta("generating", false);
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

  private emitSnapshot(): void {
    if (this.snapshotEmitted) return;
    this.snapshotEmitted = true;

    this.content = {
      ...this.content,
      initialHeight: this.params.initialHeight,
    };
    const event: ActivitySnapshotEvent = {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: this.messageId,
      activityType: ACTIVITY_TYPE,
      content: this.content,
    };
    this.onEvent(event);
  }

  private emitParamDelta(key: string, value: unknown): void {
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
    this.content = { ...this.content, [key]: value };
    const event: ActivityDeltaEvent = {
      type: EventType.ACTIVITY_DELTA,
      messageId: this.messageId,
      activityType: ACTIVITY_TYPE,
      patch: [{ op: "add", path: `/${key}`, value }],
    };
    this.onEvent(event);
  }

  private emitArrayItemDelta(arrayKey: string, value: string): void {
    this.emitSnapshot();
    const prior = this.content[arrayKey];
    this.content = {
      ...this.content,
      [arrayKey]: [...(Array.isArray(prior) ? prior : []), value],
    };
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

/**
 * Marks a snapshot as authoritative for the Open Generative UI activity type
 * only, under the `@ag-ui/client` metadata key. A client that understands the
 * key replaces just this activity type; older clients ignore the metadata and
 * keep their all-or-nothing activity rule.
 */
function ownActivityType(
  event: MessagesSnapshotEvent,
  messages: Message[],
): MessagesSnapshotEvent {
  const prior = event.metadata?.["@ag-ui/client"];
  const priorRecord: Record<string, unknown> =
    prior && typeof prior === "object" && !Array.isArray(prior)
      ? (prior as Record<string, unknown>)
      : {};
  const priorTypes = Array.isArray(priorRecord.authoritativeActivityTypes)
    ? priorRecord.authoritativeActivityTypes.filter(
        (type): type is string => typeof type === "string",
      )
    : [];
  return {
    ...event,
    messages,
    metadata: {
      ...event.metadata,
      "@ag-ui/client": {
        ...priorRecord,
        authoritativeActivityTypes: [
          ...new Set([...priorTypes, ACTIVITY_TYPE]),
        ],
      },
    },
  };
}

/**
 * Rebuilds the Open Generative UI activity for every `generateSandboxedUi`
 * call in a MESSAGES_SNAPSHOT from the call's final arguments. It uses the
 * same parser as streaming, runs no host functions and never invents a tool
 * result: a call without a result restores as `interrupted`.
 */
export function projectOpenGenerativeUIHistory(
  event: MessagesSnapshotEvent,
): MessagesSnapshotEvent {
  return projectHistory(event);
}

interface LiveCall {
  parser: ArgsParser;
  owner: AssistantMessage;
  call: ToolCall;
  result?: ToolMessage;
}

function projectHistory(
  event: MessagesSnapshotEvent,
  activeParsers = new Map<string, LiveCall>(),
): MessagesSnapshotEvent {
  const results = new Map<string, ToolMessage>();
  for (const message of event.messages)
    if (message.role === "tool") results.set(message.toolCallId, message);
  const sourceMessages = [...event.messages];
  for (const [id, live] of activeParsers) {
    if (results.has(id)) {
      activeParsers.delete(id);
      continue;
    }
    const index = sourceMessages.findIndex(
      (message) =>
        message.role === "assistant" &&
        (message.id === live.owner.id ||
          message.toolCalls?.some((call) => call.id === id)),
    );
    const owner = sourceMessages[index];
    if (owner?.role === "assistant") {
      const calls = owner.toolCalls ?? [];
      sourceMessages[index] = {
        ...owner,
        toolCalls: calls.some((call) => call.id === id)
          ? calls.map((call) => (call.id === id ? live.call : call))
          : [...calls, live.call],
      };
    } else {
      sourceMessages.push({ ...live.owner, toolCalls: [live.call] });
    }
    if (live.result) {
      let resultIndex = (index >= 0 ? index : sourceMessages.length - 1) + 1;
      while (sourceMessages[resultIndex]?.role === "tool") resultIndex++;
      sourceMessages.splice(resultIndex, 0, live.result);
    }
  }
  const messages: Message[] = [];
  for (const message of sourceMessages) {
    if (message.role === "activity" && message.activityType === ACTIVITY_TYPE)
      continue;
    messages.push(message);
    if (message.role !== "assistant") continue;
    for (const call of message.toolCalls ?? []) {
      if (call.function.name !== TOOL_NAME) continue;
      const live = activeParsers.get(call.id);
      if (live && !results.has(call.id)) {
        messages.push(live.parser.activity());
        continue;
      }
      const parser = new ArgsParser(call.id, () => {});
      parser.write(call.function.arguments);
      const result = results.get(call.id);
      const params = parser.params;
      const activity: ActivityMessage = {
        id: parser.messageId,
        role: "activity",
        activityType: ACTIVITY_TYPE,
        content: {
          ...(params.initialHeight === undefined
            ? {}
            : { initialHeight: params.initialHeight }),
          ...(params.placeholderMessages === undefined
            ? {}
            : { placeholderMessages: params.placeholderMessages }),
          ...(params.html === undefined
            ? {}
            : { html: [params.html], htmlComplete: true }),
          ...(params.css === undefined
            ? {}
            : { css: params.css, cssComplete: true }),
          ...(params.jsFunctions === undefined
            ? {}
            : { jsFunctions: params.jsFunctions, jsFunctionsComplete: true }),
          ...(params.jsExpressions === undefined
            ? {}
            : {
                jsExpressions: params.jsExpressions,
                jsExpressionsComplete: true,
              }),
          generating: false,
          status: result
            ? result.error
              ? "failed"
              : "complete"
            : "interrupted",
          ...(result?.error ? { error: result.error } : {}),
        },
      };
      messages.push(activity);
    }
  }
  return ownActivityType(event, messages);
}

export interface OpenGenerativeUIMiddlewareOptions {
  /**
   * Replay stored threads only. The backend is called with the thread and run
   * ids and nothing else from the caller (no messages, tools, context, state,
   * forwarded props or resume commands), and every MESSAGES_SNAPSHOT it returns
   * is projected with `projectOpenGenerativeUIHistory`.
   */
  readOnly?: boolean;
}

export class OpenGenerativeUIMiddleware extends Middleware {
  constructor(
    private readonly options: OpenGenerativeUIMiddlewareOptions = {},
  ) {
    super();
  }

  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    if (this.options.readOnly) {
      const replayInput: RunAgentInput = {
        threadId: input.threadId,
        runId: input.runId,
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      };
      return this.runNext(replayInput, next).pipe(
        map((event) =>
          event.type === EventType.MESSAGES_SNAPSHOT
            ? projectOpenGenerativeUIHistory(event as MessagesSnapshotEvent)
            : event,
        ),
      );
    }
    return this.processStream(this.runNextWithState(input, next));
  }

  private processStream(
    source: Observable<EventWithState>,
  ): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      let heldRunFinished: EventWithState | null = null;
      // Track active generateSandboxedUi tool call IDs → their streaming parser
      const activeParsers = new Map<string, LiveCall>();
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
          const event =
            eventWithState.event.type === EventType.MESSAGES_SNAPSHOT
              ? projectHistory(
                  eventWithState.event as MessagesSnapshotEvent,
                  activeParsers,
                )
              : eventWithState.event;

          if (heldRunFinished) {
            subscriber.next(heldRunFinished.event);
            heldRunFinished = null;
          }

          if (
            event.type === EventType.RUN_FINISHED ||
            event.type === EventType.RUN_ERROR
          ) {
            for (const { parser } of activeParsers.values()) parser.finish();
            activeParsers.clear();
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
              const owner = eventWithState.messages.find(
                (message): message is AssistantMessage =>
                  message.role === "assistant" &&
                  !!message.toolCalls?.some(
                    (call) => call.id === startEvent.toolCallId,
                  ),
              );
              const call = owner?.toolCalls?.find(
                (call) => call.id === startEvent.toolCallId,
              ) ?? {
                id: startEvent.toolCallId,
                type: "function" as const,
                function: { name: startEvent.toolCallName, arguments: "" },
              };
              activeParsers.set(startEvent.toolCallId, {
                owner: {
                  ...owner,
                  id:
                    owner?.id ??
                    startEvent.parentMessageId ??
                    startEvent.toolCallId,
                  role: "assistant",
                  toolCalls: [],
                },
                call: { ...call, function: { ...call.function } },
                parser: new ArgsParser(
                  startEvent.toolCallId,
                  (activityEvent) => {
                    subscriber.next(activityEvent);
                    flushHeldEvents(startEvent.toolCallId);
                  },
                ),
              });
              return;
            }
          }

          // Hold or emit TOOL_CALL_ARGS for genui tool calls
          if (event.type === EventType.TOOL_CALL_ARGS) {
            const argsEvent = event as ToolCallArgsEvent;
            const live = activeParsers.get(argsEvent.toolCallId);
            if (live) {
              if (!flushedToolCalls.has(argsEvent.toolCallId)) {
                heldToolCallEvents.get(argsEvent.toolCallId)!.push(event);
              } else {
                subscriber.next(event);
              }
              live.call = {
                ...live.call,
                function: {
                  ...live.call.function,
                  arguments: live.call.function.arguments + argsEvent.delta,
                },
              };
              live.parser.write(argsEvent.delta);
              return;
            }
          }

          // Hold or emit TOOL_CALL_END for genui tool calls
          if (event.type === EventType.TOOL_CALL_END) {
            const endEvent = event as { toolCallId: string } & BaseEvent;
            const parser = activeParsers.get(endEvent.toolCallId)?.parser;
            if (parser) {
              parser.finish();

              if (!flushedToolCalls.has(endEvent.toolCallId)) {
                heldToolCallEvents.get(endEvent.toolCallId)!.push(event);
              } else {
                subscriber.next(event);
              }
              return;
            }
          }

          if (event.type === EventType.TOOL_CALL_RESULT) {
            const result = event as ToolCallResultEvent;
            const live = activeParsers.get(result.toolCallId);
            if (live)
              live.result = {
                id: result.messageId,
                role: "tool",
                toolCallId: result.toolCallId,
                content: result.content,
                metadata: result.metadata,
              };
          }

          subscriber.next(event);
        },
        error: (err) => {
          for (const { parser } of activeParsers.values()) parser.finish();
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
          activeParsers.clear();
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

      return () => {
        subscription.unsubscribe();
        activeParsers.clear();
        heldToolCallEvents.clear();
      };
    });
  }
}
