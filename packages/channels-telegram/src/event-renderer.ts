import type { AgentSubscriber } from "@ag-ui/client";
import type {
  RunRenderer,
  CapturedToolCall,
  CapturedInterrupt,
} from "@copilotkit/channels";
import { ChunkedEditStream } from "./chunked-edit-stream.js";
import { telegramHtml } from "./telegram-html.js";

const INTERRUPTED_SUFFIX = "\n_(interrupted)_";

export interface CreateRunRendererArgs {
  /** Posts a new Telegram message with placeholder text; resolves with its message id. */
  postPlaceholder: (text: string) => Promise<number>;
  /** Edits the Telegram message with the given id to contain `text`. */
  editAt: (messageId: number, text: string) => Promise<void>;
  /**
   * Optional native typing indicator. When provided it is used in place of a
   * posted `🔧 using <tool>…` status line on tool-call start.
   */
  setTyping?: () => Promise<void>;
  /**
   * Custom-event names that should be treated as interrupts — captured for
   * later dispatch to an `InterruptHandler`. Defaults to `on_interrupt` (the
   * name LangGraph's AG-UI adapter emits).
   */
  interruptEventNames?: ReadonlySet<string>;
  /**
   * Whether tool calls should surface a `🔧 using <tool>…` → done status line.
   * Defaults to `true`. Tool calls are ALWAYS captured regardless of this flag.
   */
  showToolStatus?: boolean;
}

/**
 * Construct a {@link RunRenderer} for a single agent run on Telegram.
 *
 * Mirrors the Slack renderer's lifecycle, swapping Slack's `chat.update`
 * transport for {@link ChunkedEditStream} (numeric message ids + telegram
 * HTML transform) and Slack's composer status for `setTyping()` / a posted
 * status line.
 *
 * The `subscriber` is passed to `runAgent`. After the run resolves, the
 * run-loop reads `getCapturedToolCalls()` and `getPendingInterrupt()`.
 * `markInterrupted()` finalises EVERY in-flight stream (so no in-flight
 * placeholder is abandoned), appending an `_(interrupted)_` marker to any
 * stream that has real partial content.
 */
export function createRunRenderer(args: CreateRunRendererArgs): RunRenderer {
  const interruptEventNames =
    args.interruptEventNames ?? new Set<string>(["on_interrupt"]);
  const showToolStatus = args.showToolStatus ?? true;

  /** Per-AG-UI-message accumulated text (we accumulate deltas locally). */
  const buffers = new Map<string, string>();
  /** Per-AG-UI-message text stream. Lazily created on first content. */
  const streams = new Map<string, ChunkedEditStream>();
  /** Per-tool-call status message id so we can edit it on END. */
  const toolStatusIds = new Map<string, number>();
  /**
   * Once a stream has been finalised (via TEXT_MESSAGE_END or markInterrupted)
   * we drop it. Late-arriving events for the same messageId are ignored.
   */
  const finalised = new Set<string>();
  /**
   * Set when the caller intentionally aborted the run (a new turn arrived for
   * the same conversation). Suppresses the RUN_ERROR notice and stops
   * accepting further AG-UI events — the `_(interrupted)_` marker conveys the
   * state visually.
   */
  let aborted = false;

  /** Tool calls observed in this run, in event order. */
  const capturedToolCalls: CapturedToolCall[] = [];

  /** Interrupt observed via a matching `onCustomEvent`; read after runAgent. */
  let pendingInterrupt: CapturedInterrupt | undefined;

  const ensureStream = (messageId: string): ChunkedEditStream | undefined => {
    if (finalised.has(messageId)) return undefined;
    let s = streams.get(messageId);
    if (!s) {
      s = new ChunkedEditStream({
        postPlaceholder: args.postPlaceholder,
        editAt: args.editAt,
        transform: telegramHtml,
      });
      streams.set(messageId, s);
    }
    return s;
  };

  /**
   * BEST-EFFORT cleanup of tool-status placeholders that were posted on START
   * but never resolved by an END (the run ended/errored/was interrupted while
   * the tool call was still in flight). Edits each remaining placeholder to a
   * terminal marker so the stale `🔧 using <tool>…` line doesn't linger. This
   * is not a hard guarantee: each `editAt` can fail (message too old, deleted,
   * not-modified, flood-wait) and on failure it is caught + logged, NOT
   * retried — so a placeholder can still end up stranded if Telegram rejects
   * the edit. `terminal` is the marker each placeholder is edited to (e.g.
   * `✅` on finish, `⚠️ … (cancelled)` on error/interrupt).
   */
  const drainToolStatuses = async (
    terminal: (toolName: string) => string,
  ): Promise<void> => {
    if (toolStatusIds.size === 0) return;
    const tasks: Promise<void>[] = [];
    for (const [toolCallId, messageId] of Array.from(toolStatusIds.entries())) {
      const captured = capturedToolCalls.find(
        (c) => c.toolCallId === toolCallId,
      );
      const toolName = captured?.toolCallName ?? "tool";
      tasks.push(
        args
          .editAt(messageId, telegramHtml(terminal(toolName)))
          .catch((err) =>
            console.error("[telegram-renderer] tool-status drain failed:", err),
          ),
      );
    }
    toolStatusIds.clear();
    await Promise.all(tasks);
  };

  const captureToolCall = (
    toolCallId: string,
    toolCallName: string,
    toolCallArgs: Record<string, unknown>,
  ) => {
    const existing = capturedToolCalls.find((c) => c.toolCallId === toolCallId);
    if (existing) {
      existing.toolCallName = toolCallName;
      existing.toolCallArgs = toolCallArgs;
    } else {
      capturedToolCalls.push({ toolCallId, toolCallName, toolCallArgs });
    }
  };

  const subscriber: AgentSubscriber = {
    // ── 1. Text streaming ──────────────────────────────────────────────
    async onTextMessageStartEvent({ event }) {
      if (aborted) return;
      // A reused messageId (legal START→END→START across steps in some AG-UI
      // adapters) must start fresh. The first message's stream may have eagerly
      // posted a "…" placeholder and queued its content; FINISH it (flushing
      // the first message into its placeholder) before resetting. Deleting it
      // without finishing would silently lose the first message's content AND
      // leave its placeholder orphaned in the chat forever.
      const existing = streams.get(event.messageId);
      if (existing) {
        await existing
          .finish()
          .catch((e) =>
            console.error("[bot-telegram] stream finalize failed:", e),
          );
        streams.delete(event.messageId);
      }
      // Clear the finalised guard and reset the buffer so ensureStream
      // recreates a fresh stream for the second message's content.
      finalised.delete(event.messageId);
      buffers.set(event.messageId, "");
    },

    onTextMessageContentEvent({ event }) {
      if (aborted) return;
      const next = (buffers.get(event.messageId) ?? "") + (event.delta ?? "");
      buffers.set(event.messageId, next);
      ensureStream(event.messageId)?.append(next);
    },

    onTextMessageEndEvent({ event }) {
      if (aborted) return;
      // Keep the stream alive; the final flush happens in onRunFinishedEvent.
      // Marking finalised here would reopen-guard a stream that may still
      // receive its flush, so we only stop accepting NEW deltas.
      finalised.add(event.messageId);
    },

    // ── 2. Tool-call surfacing + capture ──────────────────────────────
    async onToolCallStartEvent({ event }) {
      if (aborted) return;
      // Always capture — the run-loop filters by which tools are registered.
      captureToolCall(event.toolCallId, event.toolCallName, {});
      if (!showToolStatus) return;
      if (args.setTyping) {
        await args.setTyping();
        return;
      }
      // Dedup by toolCallId so a re-emitted START can't post a second line.
      if (toolStatusIds.has(event.toolCallId)) return;
      try {
        const id = await args.postPlaceholder(
          telegramHtml(`🔧 using ${event.toolCallName}…`),
        );
        toolStatusIds.set(event.toolCallId, id);
      } catch (err) {
        console.error("[telegram-renderer] tool-start post failed:", err);
      }
    },

    onToolCallArgsEvent({ event, toolCallName, partialToolCallArgs }) {
      if (aborted) return;
      captureToolCall(
        event.toolCallId,
        toolCallName,
        (partialToolCallArgs ?? {}) as Record<string, unknown>,
      );
    },

    async onToolCallEndEvent({ event, toolCallName, toolCallArgs }) {
      if (aborted) return;
      captureToolCall(
        event.toolCallId,
        toolCallName,
        (toolCallArgs ?? {}) as Record<string, unknown>,
      );
      if (!showToolStatus) return;
      const id = toolStatusIds.get(event.toolCallId);
      if (id === undefined) return;
      try {
        await args.editAt(id, telegramHtml(`✅ ${toolCallName}`));
      } catch (err) {
        console.error("[telegram-renderer] tool-end edit failed:", err);
      }
      toolStatusIds.delete(event.toolCallId);
    },

    // ── 3. Interrupts (LangGraph `interrupt()` → AG-UI custom event) ─
    onCustomEvent({ event }) {
      if (aborted) return;
      const e = event as { name?: string; value?: unknown };
      if (!e.name || !interruptEventNames.has(e.name)) return;
      // LangGraph's AG-UI adapter ships the interrupt value as a JSON string
      // in some shapes (and as an object in others). Normalize here so
      // downstream schema validation always sees the parsed shape.
      let value = e.value;
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
          // Leave it as a string — the handler's schema will reject it
          // explicitly with a clearer error.
        }
      }
      pendingInterrupt = { eventName: e.name, value };
    },

    // ── 4. Run lifecycle: finalise streams ─────────────────────────────
    async onRunFinishedEvent() {
      if (aborted) return;
      const tasks: Promise<void>[] = [];
      for (const [id, stream] of Array.from(streams.entries())) {
        // Best-effort: a terminal-edit rejection (message too old, deleted,
        // not-modified, flood-wait) must not bubble into the AG-UI run loop.
        tasks.push(
          stream
            .finish()
            .catch((e) =>
              console.error("[bot-telegram] stream finalize failed:", e),
            ),
        );
        streams.delete(id);
        finalised.add(id);
      }
      buffers.clear();
      await Promise.all(tasks);
      // Drain any tool-status placeholders left over from a tool call whose
      // END never arrived before the run finished — flip them to done so they
      // aren't orphaned as a perpetual "🔧 using <tool>…".
      await drainToolStatuses((tool) => `✅ ${tool}`);
    },

    // ── 5. Errors ─────────────────────────────────────────────────────
    async onRunErrorEvent({ event }) {
      // Don't post a notice if we're the ones aborting; the `_(interrupted)_`
      // marker on the partial reply is the user-visible signal in that case.
      if (aborted) return;
      // Drain any in-flight text streams so partial replies are finalized
      // rather than left dangling (a _thinking…_ or partial message that
      // never resolves). Mirror the flush from onRunFinishedEvent.
      const tasks: Promise<void>[] = [];
      for (const [id, stream] of Array.from(streams.entries())) {
        tasks.push(
          stream
            .finish()
            .catch((e) =>
              console.error("[bot-telegram] stream finalize failed:", e),
            ),
        );
        streams.delete(id);
        finalised.add(id);
      }
      buffers.clear();
      await Promise.all(tasks);
      // Clean up any tool-status placeholders whose END never arrived before
      // the error — mark them cancelled rather than leaving "🔧 using <tool>…"
      // orphaned in the chat.
      await drainToolStatuses((tool) => `⚠️ ${tool} (cancelled)`);
      try {
        await args.postPlaceholder(
          telegramHtml(`⚠️ Agent error: ${event.message ?? "unknown error"}`),
        );
      } catch (err) {
        console.error("[telegram-renderer] error notice failed:", err);
      }
    },
  };

  return {
    subscriber,
    getCapturedToolCalls: () => capturedToolCalls,
    getPendingInterrupt: () => pendingInterrupt,
    clearPendingInterrupt: () => {
      pendingInterrupt = undefined;
    },
    async markInterrupted() {
      // Idempotent. Mark BEFORE any await so subsequent subscriber callbacks
      // (including the RUN_ERROR that AG-UI fires when we abort) bail.
      if (aborted) return;
      aborted = true;
      // Settle EVERY in-flight text stream. `ChunkedEditStream.append`
      // schedules its placeholder post asynchronously (on setupPromise), so a
      // stream that just received content may still report chunkCount === 0
      // until that post resolves. If we deleted such a stream without
      // finishing it, its in-flight postPlaceholder would still resolve and
      // leave a stray "…" message orphaned forever. `finish()` awaits
      // setupPromise, so it deterministically creates-and-flushes any pending
      // placeholder rather than abandoning it.
      const tasks: Promise<void>[] = [];
      for (const [id, stream] of Array.from(streams.entries())) {
        const buf = buffers.get(id) ?? "";
        if (buf.trim().length > 0) {
          // Real content: surface the interrupted marker on the partial reply
          // before finishing.
          stream.append(buf + INTERRUPTED_SUFFIX);
        }
        // Empty/whitespace buffer: just finish(). If nothing was ever posted
        // it's a no-op; if a placeholder post is in flight it gets flushed/
        // edited rather than left as a stray "…".
        tasks.push(
          stream
            .finish()
            .catch((e) =>
              console.error("[bot-telegram] stream finalize failed:", e),
            ),
        );
        streams.delete(id);
        finalised.add(id);
      }
      buffers.clear();
      await Promise.all(tasks);
      // Clean up any tool-status placeholders whose END never arrived before
      // the interrupt — mark them cancelled rather than leaving the stale
      // "🔧 using <tool>…" line orphaned in the chat.
      await drainToolStatuses((tool) => `⚠️ ${tool} (cancelled)`);
    },
  };
}
