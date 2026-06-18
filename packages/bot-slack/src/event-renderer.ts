import type { WebClient } from "@slack/web-api";
import type { KnownBlock } from "@slack/types";
import type { AgentSubscriber } from "@ag-ui/client";
import type {
  RunRenderer,
  CapturedToolCall,
  CapturedInterrupt,
} from "@copilotkit/bot";
import { ChunkedMessageStream } from "./chunked-message-stream.js";
import { markdownToMrkdwn } from "./markdown-to-mrkdwn.js";
import { autoCloseOpenMarkdown } from "./auto-close-streaming.js";
import { NativeMessageStream } from "./native-stream.js";
import type { TextStream, NativeStreamTransport } from "./native-stream.js";
import type { SlackAssistantOptions } from "./types.js";

const DEFAULT_THINKING_STATUS = "is thinking…";

/**
 * The display-transform applied to every streaming chunk before it hits
 * `chat.update` (the LEGACY transport only — the native path streams raw
 * markdown). Composed of two pure functions:
 *
 *   1. `autoCloseOpenMarkdown` — closes dangling fenced code, inline
 *      backticks, bold/italic/strike so a mid-stream buffer renders as
 *      valid mrkdwn (instead of leaking code-styling through the rest of
 *      the Slack message). When the agent eventually emits the real
 *      close marker the buffer becomes balanced and this step adds
 *      nothing, so the committed Slack message is never double-closed.
 *
 *   2. `markdownToMrkdwn` — translates the (now-balanced) markdown into
 *      Slack mrkdwn.
 */
const displayTransform = (text: string): string =>
  markdownToMrkdwn(autoCloseOpenMarkdown(text));

const INTERRUPTED_SUFFIX = "\n_(interrupted)_";

/**
 * Construct a {@link RunRenderer} for a single agent run in Slack.
 *
 * The `subscriber` is passed to `runAgent`. After the run resolves, the
 * run-loop reads `getCapturedToolCalls()` (filtering by which tools are
 * registered) and `getPendingInterrupt()`, then calls `finish()` once at
 * turn end. `markInterrupted()` is called when a new turn arrives for the
 * same conversation while this run is still streaming — it appends a
 * `_(interrupted)_` marker to any partial reply so the user sees a clear
 * visual cue that the bot stopped.
 *
 * ## Native vs legacy text streaming
 *
 * When `nativeStreaming` is set, the run uses a SINGLE turn-scoped
 * `chat.startStream` message for the whole turn: text from every AG-UI
 * message accumulates into it (separated by blank lines), and tool calls
 * surface as native `task_update` chunks INSIDE that message. The message is
 * finalized once, at `finish()`, optionally carrying a feedback row. The
 * legacy path keeps the prior behavior — one `chat.update` message per AG-UI
 * text message, plus separate `:wrench:` tool-status rows.
 */
export function createRunRenderer(args: {
  client: WebClient;
  target: { channel: string; threadTs?: string };
  /**
   * Custom-event names that should be treated as interrupts — captured
   * for later dispatch to an `InterruptHandler`. Defaults to just
   * `on_interrupt` (the name LangGraph's AG-UI adapter emits).
   */
  interruptEventNames?: ReadonlySet<string>;
  /**
   * Whether tool calls should surface as `:wrench: Calling x…` →
   * `:white_check_mark: x` status rows in the thread. Defaults to `true`.
   * Only consulted on the legacy path (and the native path's degradation
   * fallback); native streaming surfaces tool calls as in-message
   * `task_update` chunks, and pane threads use composer status.
   *
   * Status rows dedup by `toolCallId` so a tool that fires
   * `TOOL_CALL_START` twice (e.g. on graph resume after an interrupt)
   * can't post two rows for the same logical call.
   */
  showToolStatus?: boolean;
  /**
   * Present only for assistant-pane targets. Drives Slack's native
   * `assistant.threads.setStatus` ("is thinking…", "is using `tool`…")
   * instead of posting a placeholder message and `:wrench:` rows.
   */
  assistantStatus?: SlackAssistantOptions["status"];
  /**
   * When set, agent text replies stream via `chat.startStream` (native) using
   * this transport instead of `chat.update`. Falls back to the legacy
   * transport automatically if `startStream` fails. `onChunkFailure` flips the
   * renderer to `:wrench:` tool-status rows if structured chunks are
   * unsupported.
   */
  nativeStreaming?: {
    transport: NativeStreamTransport;
    onStartFailure?: (err: unknown) => void;
    /**
     * Whether structured `task_update` chunks are known to work on this
     * workspace (adapter-persisted across turns). Defaults to `true`.
     */
    taskChunks?: boolean;
    /** Called the first time a chunk append fails, so the adapter can persist the degradation. */
    onChunkFailure?: () => void;
  };
  /**
   * Native AI-feedback row (built by the adapter when `feedback` is
   * configured) attached to the finalized streamed reply via `stopStream`.
   * Native path only; omitted when absent or on legacy fallback.
   */
  feedbackBlocks?: KnownBlock[];
}): RunRenderer {
  const { client, target } = args;
  const interruptEventNames =
    args.interruptEventNames ?? new Set<string>(["on_interrupt"]);
  const showToolStatus = args.showToolStatus ?? true;
  const nativeMode = args.nativeStreaming !== undefined;

  // ── Assistant-pane status mode ──────────────────────────────────────
  // In a pane thread the run lifecycle drives native status under the
  // composer instead of placeholder/`:wrench:` messages.
  const paneStatus = args.assistantStatus;
  const paneMode = paneStatus !== undefined && target.threadTs !== undefined;
  const paneToolStatus = paneStatus?.toolStatus ?? true;

  const setPaneStatus = async (status: string): Promise<void> => {
    if (!paneMode || !target.threadTs) return;
    try {
      await client.assistant.threads.setStatus({
        channel_id: target.channel,
        thread_ts: target.threadTs,
        status,
        ...(status && paneStatus?.loadingMessages
          ? { loading_messages: [...paneStatus.loadingMessages] }
          : {}),
      });
    } catch (err) {
      console.error("[slack-renderer] setStatus failed:", err);
    }
  };
  /** Clear the composer status (best-effort). */
  const clearPaneStatus = async (): Promise<void> => {
    if (!paneMode) return;
    await setPaneStatus("");
  };
  /** Whether this run has posted any visible reply yet (drives status clear). */
  let postedReply = false;
  const onFirstReply = async (): Promise<void> => {
    if (postedReply) return;
    postedReply = true;
    await clearPaneStatus();
  };

  // ── Legacy per-message streaming state ──────────────────────────────
  /** Per-AG-UI-message accumulated text (legacy path; native uses one buffer). */
  const buffers = new Map<string, string>();
  /** Per-AG-UI-message text stream (legacy). Lazily created on first content. */
  const streams = new Map<string, TextStream>();
  /** Per-tool-call Slack message ts so we can edit it on END (legacy/degraded). */
  const toolStatusTs = new Map<string, string>();
  /**
   * Once a stream has been "finalised" (either via TEXT_MESSAGE_END or via
   * markInterrupted), we drop it. Late-arriving events for the same
   * messageId are ignored — they'd otherwise reopen a closed stream and
   * post a fresh placeholder *after* the user already saw the message
   * was over.
   */
  const finalised = new Set<string>();

  // ── Native turn-scoped streaming state ──────────────────────────────
  /** The single native stream for the whole turn (lazily created). */
  let turnStream: NativeMessageStream | undefined;
  /** All text streamed this turn (every AG-UI message concatenated). */
  let turnText = "";
  /** Set after a TEXT_MESSAGE_END so the next message inserts a blank-line gap. */
  let pendingSeparator = false;
  /** True once the turn stream has been finalized (interrupt / error / finish). */
  let turnFinalised = false;
  /**
   * Whether native structured chunks (`task_update`) are usable. Flipped off
   * the first time a chunk append fails (old workspace / missing scope), after
   * which tool progress degrades to `:wrench:` rows.
   */
  let taskChunksOk = nativeMode && (args.nativeStreaming?.taskChunks ?? true);

  /**
   * Set when the caller intentionally aborted the run (i.e. a new turn
   * arrived for the same conversation). Suppresses the RUN_ERROR /
   * AbortError warning and stops accepting further AG-UI events — the
   * `_(interrupted)_` marker conveys the state visually.
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

  // ── "Thinking…" indicator ───────────────────────────────────────────
  // Posted as soon as a run starts so there's no dead air while the agent
  // reasons / calls MCP before its first token. The streamed text reply
  // REUSES this message (the dots morph straight into the answer); if the
  // first visible output is something else (a component, a HITL picker)
  // the placeholder is removed instead. `runAgent` fires once per tool-loop
  // iteration, so we (re)post on each RUN_STARTED and clear on each
  // RUN_FINISHED — giving a "thinking" beat between steps.
  let thinkingTs: string | undefined;
  let thinkingTimer: ReturnType<typeof setInterval> | undefined;
  let thinkingClaimed = false;

  const stopThinkingTimer = () => {
    if (thinkingTimer) {
      clearInterval(thinkingTimer);
      thinkingTimer = undefined;
    }
  };

  const startThinking = async () => {
    if (aborted || thinkingTs || thinkingClaimed) return;
    try {
      const posted = await client.chat.postMessage({
        channel: target.channel,
        thread_ts: target.threadTs,
        text: ":hourglass_flowing_sand:  _thinking…_",
      });
      if (!posted.ts) return;
      thinkingTs = posted.ts;
      let frame = 0;
      thinkingTimer = setInterval(() => {
        if (thinkingClaimed || !thinkingTs) return;
        frame = (frame + 1) % 3;
        const dots = ".".repeat(frame + 1);
        void client.chat
          .update({
            channel: target.channel,
            ts: thinkingTs,
            text: `:hourglass_flowing_sand:  _thinking${dots}_`,
          })
          .catch(() => {});
      }, 1200);
    } catch (err) {
      console.error("[slack-renderer] thinking placeholder failed:", err);
    }
  };

  // Hand the standing placeholder to the text stream so its dots become the
  // reply. Returns the ts once; afterwards the message belongs to the stream.
  const claimThinking = (): string | undefined => {
    if (thinkingTs && !thinkingClaimed) {
      thinkingClaimed = true;
      stopThinkingTimer();
      const ts = thinkingTs;
      thinkingTs = undefined;
      return ts;
    }
    return undefined;
  };

  // Remove the placeholder if it's still standing and wasn't claimed by text.
  const clearThinking = async () => {
    stopThinkingTimer();
    const ts = thinkingTs;
    thinkingTs = undefined;
    if (ts && !thinkingClaimed) {
      try {
        await client.chat.delete({ channel: target.channel, ts });
      } catch {
        /* best-effort: the message may already be gone */
      }
    }
  };

  // The shipped chat.update streamer (mrkdwn-translated). Also the automatic
  // fallback for the native transport. Reuses the standing "thinking…" message
  // when one exists so the dots morph straight into the reply.
  const makeLegacyStream = (): TextStream =>
    new ChunkedMessageStream({
      postPlaceholder: async (text) => {
        const claimed = claimThinking();
        if (claimed) {
          await client.chat.update({
            channel: target.channel,
            ts: claimed,
            text,
          });
          await onFirstReply();
          return claimed;
        }
        const posted = await client.chat.postMessage({
          channel: target.channel,
          thread_ts: target.threadTs,
          text,
        });
        if (!posted.ts) throw new Error("postMessage returned no ts");
        await onFirstReply();
        return posted.ts;
      },
      updateAt: async (ts, text) => {
        await client.chat.update({ channel: target.channel, ts, text });
      },
      transform: displayTransform,
    });

  // The single native turn stream — raw markdown, no mrkdwn translation, with
  // interleaved `task_update` chunks. Reuses the "thinking…" placeholder when
  // present (drops it on first content).
  const ensureTurnStream = (): NativeMessageStream => {
    if (turnStream) return turnStream;
    const ns = args.nativeStreaming!;
    turnStream = new NativeMessageStream({
      transport: {
        startStream: async () => {
          const ts = await ns.transport.startStream();
          // The native message owns the bubble now; drop the placeholder and
          // clear any pane status (the reply is visible).
          await clearThinking();
          await onFirstReply();
          return ts;
        },
        appendText: (ts, md) => ns.transport.appendText(ts, md),
        appendChunks: (ts, chunks) => ns.transport.appendChunks(ts, chunks),
        stopStream: (ts, blocks) => ns.transport.stopStream(ts, blocks),
      },
      fallback: makeLegacyStream,
      onStartFailure: ns.onStartFailure,
      onChunkFailure: () => {
        // Structured chunks unsupported on this workspace — degrade tool
        // progress to `:wrench:` rows for the rest of the run, and let the
        // adapter persist it so later turns skip chunks entirely.
        taskChunksOk = false;
        ns.onChunkFailure?.();
      },
    });
    return turnStream;
  };

  const ensureLegacyStream = (messageId: string): TextStream | undefined => {
    if (finalised.has(messageId)) return undefined;
    let s = streams.get(messageId);
    if (!s) {
      s = makeLegacyStream();
      streams.set(messageId, s);
    }
    return s;
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

  /** Post a `:wrench:` tool-start row (legacy path / native degradation). */
  const postToolStartRow = async (
    toolCallId: string,
    toolCallName: string,
  ): Promise<void> => {
    if (!showToolStatus) return;
    if (toolStatusTs.has(toolCallId)) return; // dedup
    try {
      await clearThinking();
      const posted = await client.chat.postMessage({
        channel: target.channel,
        thread_ts: target.threadTs,
        text: `:wrench: Calling \`${toolCallName}\`…`,
      });
      if (posted.ts) toolStatusTs.set(toolCallId, posted.ts);
    } catch (err) {
      console.error("[slack-renderer] tool-start post failed:", err);
    }
  };

  /** Edit the `:wrench:` row to a checkmark on END (legacy path / native degradation). */
  const finishToolStatusRow = async (
    toolCallId: string,
    toolCallName: string,
  ): Promise<void> => {
    if (!showToolStatus) return;
    const ts = toolStatusTs.get(toolCallId);
    if (!ts) return;
    try {
      await client.chat.update({
        channel: target.channel,
        ts,
        text: `:white_check_mark: \`${toolCallName}\``,
      });
    } catch (err) {
      console.error("[slack-renderer] tool-end update failed:", err);
    }
    toolStatusTs.delete(toolCallId);
  };

  const subscriber: AgentSubscriber = {
    // ── 0. Run lifecycle: thinking indicator ───────────────────────────
    async onRunStartedEvent() {
      if (aborted) return;
      if (paneMode) {
        // Native status under the composer instead of a placeholder message.
        await setPaneStatus(paneStatus?.thinking || DEFAULT_THINKING_STATUS);
      } else {
        await startThinking();
      }
    },
    async onRunFinishedEvent() {
      // The turn isn't necessarily over (the run-loop may re-invoke for tool
      // results), so the native turn stream stays OPEN here — it's finalized in
      // `finish()`. Just tidy the per-iteration "thinking…" bubble.
      await clearThinking();
      // In a pane thread, a posted reply auto-clears Slack's status; clear it
      // explicitly when the run produced no visible reply yet.
      if (paneMode && !postedReply) await clearPaneStatus();
    },

    // ── 1. Text streaming ──────────────────────────────────────────────
    onTextMessageStartEvent({ event }) {
      if (aborted) return;
      if (nativeMode) {
        // A new message after prior text → blank-line gap in the one bubble.
        if (turnText.length > 0) pendingSeparator = true;
        return;
      }
      buffers.set(event.messageId, "");
    },

    onTextMessageContentEvent({ event }) {
      if (aborted) return;
      const delta = event.delta ?? "";
      if (nativeMode) {
        if (turnFinalised) return;
        if (pendingSeparator && turnText.length > 0) {
          turnText += "\n\n";
          pendingSeparator = false;
        }
        turnText += delta;
        ensureTurnStream().append(turnText);
        return;
      }
      const next = (buffers.get(event.messageId) ?? "") + delta;
      buffers.set(event.messageId, next);
      ensureLegacyStream(event.messageId)?.append(next);
    },

    async onTextMessageEndEvent({ event }) {
      if (aborted) return;
      if (nativeMode) {
        // Do NOT finish the turn stream — more messages / tools may follow.
        // The blank-line separator is applied on the next message's first
        // content. Finalization happens in `finish()`.
        return;
      }
      const stream = streams.get(event.messageId);
      if (stream) {
        await stream.finish();
        streams.delete(event.messageId);
      }
      buffers.delete(event.messageId);
      finalised.add(event.messageId);
    },

    // ── 2. Tool-call surfacing + capture ──────────────────────────────
    async onToolCallStartEvent({ event }) {
      if (aborted) return;
      // Pane threads surface tool activity as live composer status, not rows.
      // Each setStatus also resets Slack's status timeout.
      if (paneMode) {
        if (paneToolStatus) {
          await setPaneStatus(`is using \`${event.toolCallName}\`…`);
        }
        return;
      }
      // Native path: surface the call as an in-message `task_update` chunk.
      if (nativeMode && taskChunksOk) {
        ensureTurnStream().appendChunk({
          type: "task_update",
          id: event.toolCallId,
          title: `Using \`${event.toolCallName}\``,
          status: "in_progress",
        });
        return;
      }
      // Legacy path (or native degraded): a `:wrench:` status row.
      await postToolStartRow(event.toolCallId, event.toolCallName);
    },

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
      // Pane threads use live status (set on START); no per-call rows to edit.
      if (paneMode) return;
      // Native path: complete the in-message `task_update`.
      if (nativeMode && taskChunksOk) {
        ensureTurnStream().appendChunk({
          type: "task_update",
          id: event.toolCallId,
          title: `Used \`${toolCallName}\``,
          status: "complete",
        });
        return;
      }
      // Legacy path (or native degraded): edit the `:wrench:` row to a check.
      await finishToolStatusRow(event.toolCallId, toolCallName);
    },

    // ── 3. Interrupts (LangGraph `interrupt()` → AG-UI custom event) ─
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
    async onRunErrorEvent({ event }) {
      // Don't post a warning if we're the ones aborting the run; the
      // `_(interrupted)_` marker on the partial reply is the user-visible
      // signal in that case.
      await clearThinking();
      if (paneMode) await clearPaneStatus();
      // Close any open native turn stream so the partial reply is committed.
      await finalizeTurnStream();
      if (aborted) return;
      try {
        await client.chat.postMessage({
          channel: target.channel,
          thread_ts: target.threadTs,
          text: `:warning: Agent error: ${event.message ?? "unknown error"}`,
        });
      } catch (err) {
        console.error("[slack-renderer] error notice failed:", err);
      }
    },
  };

  /** Finalize the native turn stream once (idempotent), attaching feedback if any. */
  const finalizeTurnStream = async (): Promise<void> => {
    if (turnFinalised) return;
    turnFinalised = true;
    if (turnStream) {
      // Attach the feedback row only to a COMPLETE reply that streamed text —
      // never to an interrupted/aborted partial (no point rating a half answer).
      const blocks =
        !aborted && turnText.length > 0 ? args.feedbackBlocks : undefined;
      await turnStream.finish(blocks);
    }
  };

  return {
    subscriber,
    getCapturedToolCalls: () => capturedToolCalls,
    getPendingInterrupt: () => pendingInterrupt,
    clearPendingInterrupt: () => {
      pendingInterrupt = undefined;
    },
    async finish() {
      // Turn-end hook (called by the engine after the run-loop resolves).
      // No-op if the run was interrupted (markInterrupted already drained).
      if (aborted) return;
      await finalizeTurnStream();
    },
    async markInterrupted() {
      // Idempotent. Mark BEFORE any await so subsequent subscriber
      // callbacks (including the RUN_ERROR that AG-UI fires when we
      // abort) see the flag and bail.
      if (aborted) return;
      aborted = true;
      // Drop any standing "thinking…" bubble; the interrupted marker (or
      // the next turn) is the user-visible signal now.
      await clearThinking();
      if (paneMode) await clearPaneStatus();
      // Native turn stream: append the interrupted marker to the partial reply
      // and finalize it.
      if (nativeMode) {
        if (turnStream && turnText.length > 0 && !turnFinalised) {
          turnStream.append(turnText + INTERRUPTED_SUFFIX);
        }
        await finalizeTurnStream();
      }
      // Legacy per-message streams: append the marker and drain. Streams with
      // no content yet are silently dropped (the bot never posted anything).
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
