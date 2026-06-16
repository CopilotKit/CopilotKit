import type { WebClient } from "@slack/web-api";
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
 * `chat.update`. Composed of two pure functions:
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
 * registered) and `getPendingInterrupt()`. `markInterrupted()` is called
 * when a new turn arrives for the same conversation while this run is
 * still streaming — it appends a `_(interrupted)_` marker to any partial
 * reply so the user sees a clear visual cue that the bot stopped.
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
   * transport automatically if `startStream` fails.
   */
  nativeStreaming?: {
    transport: NativeStreamTransport;
    onStartFailure?: (err: unknown) => void;
  };
}): RunRenderer {
  const { client, target } = args;
  const interruptEventNames =
    args.interruptEventNames ?? new Set<string>(["on_interrupt"]);
  const showToolStatus = args.showToolStatus ?? true;

  // ── Assistant-pane status mode ──────────────────────────────────────
  // In a pane thread the run lifecycle drives native status under the
  // composer instead of placeholder/`:wrench:` messages.
  const paneStatus = args.assistantStatus;
  const paneMode = paneStatus !== undefined && target.threadTs !== undefined;
  const paneToolStatus = paneStatus?.toolStatus ?? true;
  // Native streaming outside the pane (e.g. a channel thread): the reply renders
  // with Slack's native streaming UI, and Slack has no composer-status surface
  // here, so we skip the legacy "thinking…" placeholder and `:wrench:` tool rows
  // entirely and let the native stream speak for itself. (paneMode still wins
  // when present.)
  const nativeNoStatus = args.nativeStreaming !== undefined && !paneMode;

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

  /** Per-AG-UI-message accumulated text (we accumulate deltas locally). */
  const buffers = new Map<string, string>();
  /** Per-AG-UI-message text stream (native or legacy). Lazily created on first content. */
  const streams = new Map<string, TextStream>();
  /** Per-tool-call Slack message ts so we can edit it on END. */
  const toolStatusTs = new Map<string, string>();
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

  // Native chat.startStream transport — raw markdown, no mrkdwn translation.
  const makeNativeStream = (): TextStream => {
    const ns = args.nativeStreaming!;
    return new NativeMessageStream({
      transport: {
        startStream: async () => {
          const ts = await ns.transport.startStream();
          // The native message owns the bubble now; drop the placeholder and
          // clear any pane status (the reply is visible).
          await clearThinking();
          await onFirstReply();
          return ts;
        },
        appendStream: (ts, md) => ns.transport.appendStream(ts, md),
        stopStream: (ts) => ns.transport.stopStream(ts),
      },
      fallback: makeLegacyStream,
      onStartFailure: ns.onStartFailure,
    });
  };

  const ensureStream = (messageId: string): TextStream | undefined => {
    if (finalised.has(messageId)) return undefined;
    let s = streams.get(messageId);
    if (!s) {
      s = args.nativeStreaming ? makeNativeStream() : makeLegacyStream();
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

  const subscriber: AgentSubscriber = {
    // ── 0. Run lifecycle: thinking indicator ───────────────────────────
    async onRunStartedEvent() {
      if (aborted) return;
      if (paneMode) {
        // Native status under the composer instead of a placeholder message.
        await setPaneStatus(paneStatus?.thinking || DEFAULT_THINKING_STATUS);
      } else if (nativeNoStatus) {
        // Native streaming in a channel: no placeholder; the native stream
        // (and its built-in streaming indicator) is the only surface.
      } else {
        await startThinking();
      }
    },
    async onRunFinishedEvent() {
      // If the run produced a streamed reply it already claimed the
      // placeholder; otherwise (tool/component/HITL output, or nothing)
      // this removes the leftover "thinking…" bubble.
      await clearThinking();
      // In a pane thread, a posted reply auto-clears Slack's status; clear it
      // explicitly when the run produced no visible reply.
      if (paneMode && !postedReply) await clearPaneStatus();
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
      // Native streaming (channel): no `:wrench:` rows — the native stream is
      // the only surface. Tool calls are still captured below for the run-loop.
      if (nativeNoStatus) return;
      // Dedup by toolCallId so a tool that re-emits START on resume can't
      // post a second status row.
      if (!showToolStatus) return;
      if (toolStatusTs.has(event.toolCallId)) return;
      try {
        await clearThinking();
        const posted = await client.chat.postMessage({
          channel: target.channel,
          thread_ts: target.threadTs,
          text: `:wrench: Calling \`${event.toolCallName}\`…`,
        });
        if (posted.ts) toolStatusTs.set(event.toolCallId, posted.ts);
      } catch (err) {
        console.error("[slack-renderer] tool-start post failed:", err);
      }
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
      // Native streaming (channel): no rows were posted, nothing to update.
      if (nativeNoStatus) return;
      if (!showToolStatus) return;
      const ts = toolStatusTs.get(event.toolCallId);
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
      toolStatusTs.delete(event.toolCallId);
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

  return {
    subscriber,
    getCapturedToolCalls: () => capturedToolCalls,
    getPendingInterrupt: () => pendingInterrupt,
    clearPendingInterrupt: () => {
      pendingInterrupt = undefined;
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
