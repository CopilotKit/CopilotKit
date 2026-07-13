import type { AgentSubscriber } from "@ag-ui/client";
import type {
  RunRenderer,
  CapturedToolCall,
  CapturedInterrupt,
} from "@copilotkit/channels-core";
import { ChunkedMessageStream } from "./chunked-message-stream.js";
import { discordMarkdown } from "./markdown.js";
import { autoCloseOpenMarkdown } from "./auto-close-streaming.js";

/**
 * The display-transform applied to every streaming chunk before it hits
 * `message.edit`. Composed of two pure functions:
 *
 *   1. `autoCloseOpenMarkdown` — closes dangling fenced code, inline
 *      backticks, bold/italic/strike so a mid-stream buffer renders as
 *      valid Discord markdown (instead of leaking code-styling through the
 *      rest of the message). When the agent eventually emits the real
 *      close marker the buffer becomes balanced and this step adds
 *      nothing, so the committed message is never double-closed.
 *
 *   2. `discordMarkdown` — translates the (now-balanced) markdown for
 *      Discord (GFM table → fenced block; everything else is identity).
 */
const displayTransform = (s: string): string =>
  discordMarkdown(autoCloseOpenMarkdown(s));

const INTERRUPTED_SUFFIX = "\n_(interrupted)_";

/**
 * Minimal structural type for a Discord text-channel (or thread) so unit
 * tests can inject a fake without opening a Gateway connection.
 */
export interface ChannelLike {
  sendTyping(): Promise<void>;
  send(payload: string | { content: string }): Promise<{
    id: string;
    edit(p: string | { content: string }): Promise<unknown>;
  }>;
}

/**
 * Construct a {@link RunRenderer} for a single agent run in Discord.
 *
 * The `subscriber` is passed to `runAgent`. After the run resolves, the
 * run-loop reads `getCapturedToolCalls()` (filtering by which tools are
 * registered) and `getPendingInterrupt()`. `markInterrupted()` is called
 * when a new turn arrives for the same conversation while this run is
 * still streaming — it appends a `_(interrupted)_` marker to any partial
 * reply so the user sees a clear visual cue that the bot stopped.
 */
export function createRunRenderer(args: {
  channel: ChannelLike;
  /**
   * Custom-event names that should be treated as interrupts — captured
   * for later dispatch to an `InterruptHandler`. Defaults to just
   * `on_interrupt` (the name LangGraph's AG-UI adapter emits).
   */
  interruptEventNames?: ReadonlySet<string>;
}): RunRenderer {
  const { channel } = args;
  const interruptEventNames =
    args.interruptEventNames ?? new Set<string>(["on_interrupt"]);

  // ── Typing heartbeat ───────────────────────────────────────────────────
  // Discord's typing indicator auto-expires after ~10 s. A single
  // sendTyping() on run start leaves dead air whenever the agent spends
  // longer than that reasoning or waiting on a slow MCP/tool call before
  // its first token — the indicator vanishes and the bot looks crashed.
  // So we refresh typing on an interval for the lifetime of the run and
  // stop on the first terminal signal (RUN_FINISHED / RUN_ERROR / abort).
  // Best-effort: a failing sendTyping must never crash the run. A refresh
  // cap bounds the worst case if no terminal event ever arrives.
  const TYPING_REFRESH_MS = 8000;
  const TYPING_MAX_REFRESHES = 40; // ~5.3 min safety cap against a leaked timer
  let typingTimer: ReturnType<typeof setInterval> | undefined;
  let typingRefreshes = 0;
  const sendTypingSafe = (): void => {
    void Promise.resolve(channel.sendTyping()).catch(() => {
      /* best-effort */
    });
  };
  const startTyping = (): void => {
    if (typingTimer) return;
    typingRefreshes = 0;
    sendTypingSafe();
    typingTimer = setInterval(() => {
      if (++typingRefreshes >= TYPING_MAX_REFRESHES) {
        stopTyping();
        return;
      }
      sendTypingSafe();
    }, TYPING_REFRESH_MS);
    // Don't keep the process alive solely for the typing heartbeat.
    (typingTimer as { unref?: () => void }).unref?.();
  };
  const stopTyping = (): void => {
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = undefined;
    }
  };

  /** Per-AG-UI-message accumulated text (we accumulate deltas locally). */
  const buffers = new Map<string, string>();
  /** Per-AG-UI-message ChunkedMessageStream. Lazily created on first content. */
  const streams = new Map<string, ChunkedMessageStream>();
  /**
   * One handle per posted Discord message, keyed by the id returned from
   * `channel.send`. A long agent reply (>2000 chars) is split by
   * {@link ChunkedMessageStream} into several Discord messages, and
   * `updateAt(id, …)` must edit the message that owns `id` — NOT a single
   * per-AG-UI-message handle, which every new chunk would overwrite,
   * routing all edits to the last-posted message. Mirrors the `handles`
   * Map in adapter.ts `stream()`. Shared across every stream in this run
   * (Discord ids are globally unique, so there's no collision risk).
   */
  const handles = new Map<
    string,
    { edit(p: string | { content: string }): Promise<unknown> }
  >();
  /**
   * Once a stream has been "finalised" (either via TEXT_MESSAGE_END or via
   * markInterrupted), we drop it. Late-arriving events for the same
   * messageId are ignored — they'd otherwise reopen a closed stream and
   * post a fresh placeholder *after* the user already saw the message
   * was over.
   */
  const finalised = new Set<string>();
  /**
   * Set when the caller intentionally aborted the run (i.e. a new turn
   * arrived for the same conversation). Suppresses further AG-UI event
   * processing — the `_(interrupted)_` marker conveys the state visually.
   */
  let aborted = false;

  /** Tool calls observed in this run, in event order. */
  const capturedToolCalls: CapturedToolCall[] = [];

  /**
   * Interrupt observed via a matching `onCustomEvent`. The React
   * `useInterrupt` pattern buffers locally and commits on run-finalize,
   * which we mirror via this single-slot variable — the run-loop reads it
   * after `runAgent` resolves.
   */
  let pendingInterrupt: CapturedInterrupt | undefined;

  const ensureStream = (
    messageId: string,
  ): ChunkedMessageStream | undefined => {
    if (finalised.has(messageId)) return undefined;
    let s = streams.get(messageId);
    if (!s) {
      s = new ChunkedMessageStream({
        postPlaceholder: async (text) => {
          const m = await channel.send(text);
          handles.set(m.id, m);
          return m.id;
        },
        updateAt: async (id, text) => {
          await handles.get(id)?.edit(text);
        },
        transform: displayTransform,
      });
      streams.set(messageId, s);
    }
    return s;
  };

  // ── Tool-call dedup (verbatim from bot-slack/src/event-renderer.ts) ──
  // Keep a single entry per toolCallId, overwriting on ARGS and END so
  // the captured entry always holds the latest parsed shape.
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
    // ── 0. Run lifecycle: typing heartbeat ────────────────────────────
    // Start the typing heartbeat so the indicator stays alive through long
    // tool/MCP calls (see startTyping above), not just the first ~10 s.
    onRunStartedEvent() {
      if (aborted) return;
      startTyping();
    },

    // Stop the heartbeat once the run completes so the indicator doesn't
    // linger past the final message.
    onRunFinishedEvent() {
      stopTyping();
    },

    // ── 1. Text streaming ──────────────────────────────────────────────
    onTextMessageStartEvent({ event }) {
      if (aborted) return;
      buffers.set(event.messageId, "");
    },

    onTextMessageContentEvent({ event }) {
      if (aborted) return;
      const next = (buffers.get(event.messageId) ?? "") + (event.delta ?? "");
      buffers.set(event.messageId, next);
      ensureStream(event.messageId)?.append(next);
    },

    async onTextMessageEndEvent({ event }) {
      if (aborted) return;
      const stream = streams.get(event.messageId);
      if (stream) {
        await stream.finish();
        streams.delete(event.messageId);
      }
      buffers.delete(event.messageId);
      finalised.add(event.messageId);
    },

    // ── 2. Tool-call capture ──────────────────────────────────────────
    onToolCallArgsEvent({ event, toolCallName, partialToolCallArgs }) {
      if (aborted) return;
      // Accumulate partial args so the captured entry tracks the latest
      // parsed shape as args stream in. We keep a single entry per
      // toolCallId, overwriting `toolCallArgs`.
      captureToolCall(
        event.toolCallId,
        toolCallName,
        (partialToolCallArgs ?? {}) as Record<string, unknown>,
      );
    },

    async onToolCallEndEvent({ event, toolCallName, toolCallArgs }) {
      if (aborted) return;
      // Capture EVERY tool call — the run-loop filters by which tools are
      // registered. A tool with no `args` events still lands here.
      captureToolCall(
        event.toolCallId,
        toolCallName,
        (toolCallArgs ?? {}) as Record<string, unknown>,
      );
    },

    // ── 3. Interrupts (LangGraph `interrupt()` → AG-UI custom event) ─
    // Verbatim from bot-slack/src/event-renderer.ts.
    onCustomEvent({ event }) {
      if (aborted) return;
      const e = event as { name?: string; value?: unknown };
      if (!e.name || !interruptEventNames.has(e.name)) return;
      // LangGraph's AG-UI adapter ships the interrupt value as a JSON
      // string in some shapes (and as an object in others). Normalize
      // here so downstream schema validation always sees the parsed shape.
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

    // ── 4. Errors ─────────────────────────────────────────────────────
    // When an agent run fails (RUN_ERROR), surface a visible warning in
    // the channel so the user isn't left staring at an expired typing
    // indicator with no feedback. Suppressed when the abort was
    // self-initiated — the `_(interrupted)_` marker is the user-visible
    // signal in that case. Best-effort, like the typing call: a failure
    // here must never crash the run.
    async onRunErrorEvent({ event }) {
      stopTyping();
      if (aborted) return;
      try {
        await channel.send(
          `⚠️ Agent error: ${event.message ?? "unknown error"}`,
        );
      } catch (err) {
        console.error("[discord-renderer] error notice failed:", err);
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
      // Idempotent. Mark BEFORE any await so subsequent subscriber
      // callbacks see the flag and bail.
      if (aborted) return;
      aborted = true;
      stopTyping();
      // For each in-flight text-message stream, append the interrupted
      // marker and drain. Streams that have no content yet are silently
      // dropped (the bot never posted anything for them).
      const tasks: Promise<void>[] = [];
      for (const [id, stream] of Array.from(streams.entries())) {
        const buf = buffers.get(id) ?? "";
        if (buf.length > 0) {
          stream.append(buf + INTERRUPTED_SUFFIX);
          tasks.push(stream.finish());
        }
        streams.delete(id);
        finalised.add(id);
      }
      buffers.clear();
      await Promise.all(tasks);
    },
  };
}
