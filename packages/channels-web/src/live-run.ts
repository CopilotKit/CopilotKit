import { EventType } from "@ag-ui/core";
import type { BaseEvent } from "@ag-ui/core";
import { AGUI_MEDIA_TYPE, EventEncoder } from "@ag-ui/encoder";

/** Event types that open a span, the matching close type, and the id field. */
const SPANS: ReadonlyArray<{
  open: EventType;
  close: EventType;
  idField: string;
}> = [
  {
    open: EventType.TEXT_MESSAGE_START,
    close: EventType.TEXT_MESSAGE_END,
    idField: "messageId",
  },
  {
    open: EventType.TOOL_CALL_START,
    close: EventType.TOOL_CALL_END,
    idField: "toolCallId",
  },
  {
    open: EventType.STEP_STARTED,
    close: EventType.STEP_FINISHED,
    idField: "stepName",
  },
  {
    open: EventType.REASONING_START,
    close: EventType.REASONING_END,
    idField: "messageId",
  },
  {
    open: EventType.REASONING_MESSAGE_START,
    close: EventType.REASONING_MESSAGE_END,
    idField: "messageId",
  },
];

/**
 * One open HTTP response for one AG-UI run request.
 *
 * It owns the SSE stream: it writes `RUN_STARTED` first, forwards events, and
 * ends with `RUN_FINISHED` or `RUN_ERROR`. It also remembers which messages,
 * tool calls, steps, and reasoning spans are still open, and closes them
 * before `RUN_FINISHED`, because AG-UI clients reject a run that finishes
 * with an open span.
 */
export class LiveRun {
  readonly stream: ReadableStream<Uint8Array>;
  readonly contentType: string;
  /** Set when the agent reported `RUN_ERROR`. The run then ends with this error. */
  innerError: string | undefined;

  private readonly encoder: EventEncoder;
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private closed = false;
  /** `type:id` of each open span, in open order. */
  private readonly open = new Map<string, BaseEvent>();

  constructor(
    readonly threadId: string,
    readonly runId: string,
    accept: string | null,
  ) {
    // Protobuf only when the client names it. A generic `Accept: */*` (plain
    // `fetch`, curl) gets SSE, which every AG-UI client reads.
    this.encoder = new EventEncoder(
      accept?.includes(AGUI_MEDIA_TYPE) ? { accept } : undefined,
    );
    this.contentType = this.encoder.getContentType();
    this.stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.closed = true;
      },
    });
    this.write({
      type: EventType.RUN_STARTED,
      threadId,
      runId,
    } as BaseEvent);
  }

  /** True while events can still reach the client. */
  get isOpen(): boolean {
    return !this.closed;
  }

  /**
   * Write one event. Returns `false` when the response is already closed.
   * Lifecycle events (`RUN_*`) are refused: only this class writes them.
   */
  emit(event: BaseEvent): boolean {
    if (this.closed) return false;
    if (
      event.type === EventType.RUN_STARTED ||
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      return false;
    }
    this.track(event);
    return this.write(event);
  }

  /** Close open spans, write `RUN_FINISHED` (or `RUN_ERROR` after an agent error), and end the stream. */
  finish(): void {
    if (this.closed) return;
    if (this.innerError !== undefined) {
      this.fail(new Error(this.innerError));
      return;
    }
    for (const opener of [...this.open.values()].toReversed()) {
      const span = SPANS.find((s) => s.open === opener.type)!;
      const id = (opener as unknown as Record<string, unknown>)[span.idField];
      this.write({ type: span.close, [span.idField]: id } as BaseEvent);
    }
    this.open.clear();
    this.write({
      type: EventType.RUN_FINISHED,
      threadId: this.threadId,
      runId: this.runId,
    } as BaseEvent);
    this.end();
  }

  /** Write `RUN_ERROR` and end the stream. */
  fail(error: unknown): void {
    if (this.closed) return;
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    this.write({ type: EventType.RUN_ERROR, message } as BaseEvent);
    this.end();
  }

  /** Stop writing without a terminal event (the client went away). */
  abort(): void {
    if (this.closed) return;
    this.end();
  }

  private track(event: BaseEvent): void {
    for (const span of SPANS) {
      const id = (event as unknown as Record<string, unknown>)[span.idField];
      if (event.type === span.open) {
        this.open.set(`${span.open}:${String(id)}`, event);
        return;
      }
      if (event.type === span.close) {
        this.open.delete(`${span.open}:${String(id)}`);
        return;
      }
    }
  }

  private write(event: BaseEvent): boolean {
    if (this.closed) return false;
    try {
      this.controller.enqueue(this.encoder.encodeBinary(event));
      return true;
    } catch {
      // The consumer cancelled the stream between our check and the write.
      this.closed = true;
      return false;
    }
  }

  private end(): void {
    this.closed = true;
    try {
      this.controller.close();
    } catch {
      // Already closed or cancelled by the consumer.
    }
  }
}
