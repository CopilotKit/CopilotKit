import type { WebClient } from "@slack/web-api";
import type { AgentSubscriber } from "@ag-ui/client";
import type { ActivityMessage } from "@ag-ui/core";
import { ChunkedMessageStream } from "./chunked-message-stream.js";
import { markdownToMrkdwn } from "./markdown-to-mrkdwn.js";
import { autoCloseOpenMarkdown } from "./auto-close-streaming.js";
import type { CapturedInterrupt } from "./interrupt.js";
import type { ReplyTarget } from "./types.js";
import {
  selectActivityRenderer,
  type ActivityMessageRenderer,
} from "./activity-message-renderer.js";

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
 * Returned by `createSlackEventRenderer`. The `subscriber` is passed to
 * `runAgent`. `markInterrupted` is called when a new turn arrives for the
 * same conversation while this run is still streaming — it appends a
 * `_(interrupted)_` marker to any partial reply so the user sees a clear
 * visual cue that the bot stopped.
 */
export interface CapturedToolCall {
  toolCallId: string;
  toolCallName: string;
  toolCallArgs: Record<string, unknown>;
}

export interface SlackEventRendererHandle {
  subscriber: AgentSubscriber;
  markInterrupted: () => Promise<void>;
  /**
   * Frontend-tool calls captured during this run. The turn-runner reads
   * this after `runAgent` resolves; any entry whose name is in the
   * frontend-tool registry gets executed and its result pushed back to
   * the agent's message history before the next iteration of the loop.
   */
  getCapturedToolCalls: () => readonly CapturedToolCall[];
  /**
   * If the agent's run finalized at a LangGraph `interrupt(...)` call,
   * the AG-UI runtime emits a custom event whose name is `on_interrupt`
   * (or a configured equivalent) with the interrupt payload as `value`.
   * The turn-runner picks this up after `runAgent` resolves and routes
   * it to the matching `InterruptHandler` for rendering + resume.
   */
  getPendingInterrupt: () => CapturedInterrupt | undefined;
  /** Clear the captured interrupt — call after consuming it. */
  clearPendingInterrupt: () => void;
}

export function createSlackEventRenderer(args: {
  client: WebClient;
  target: ReplyTarget;
  /**
   * Names of frontend tools — used to skip status posts for them since
   * frontend-tool calls are handled by the bridge and the result lands
   * back inline (no need to pre-announce). Note that `showToolStatus`
   * is also checked: by default the bridge posts no status rows at all.
   */
  frontendToolNames?: ReadonlySet<string>;
  /**
   * Custom-event names that should be treated as interrupts — captured
   * for later dispatch to an `InterruptHandler`. Defaults to just
   * `on_interrupt` (the name LangGraph's AG-UI adapter emits).
   */
  interruptEventNames?: ReadonlySet<string>;
  /**
   * Whether (and which) backend tool calls should surface as
   * `:wrench: Calling x…` → `:white_check_mark: x` status rows in the
   * thread.
   *
   *   - `false` / omitted (default): no status rows at all. The picker
   *     a tool renders, the streamed text reply, or the agent's final
   *     message *is* the user-visible affordance. Tool-name flashing
   *     into the thread is noise.
   *   - `true`: every backend tool call gets a status row.
   *   - `string[]`: only the named tools surface status rows.
   *
   * Even when enabled, status rows dedup by `toolCallId` so a tool that
   * fires `TOOL_CALL_START` twice (e.g. on graph resume after an
   * interrupt) can't post two rows for the same logical call.
   */
  showToolStatus?: boolean | ReadonlyArray<string>;
  /**
   * Renderers for AG-UI activity messages. The bridge picks one per
   * incoming `ActivitySnapshotEvent` by `activityType` (with `"*"`
   * wildcard) and posts the resulting Block Kit blocks. See
   * `SlackBridgeConfig.renderActivityMessages`.
   */
  renderActivityMessages?: ReadonlyArray<ActivityMessageRenderer<any>>;
  /**
   * Optional agent identifier used for renderer matching. When a
   * renderer specifies `agentId`, only activity messages produced
   * by that agent fire it.
   */
  agentId?: string;
}): SlackEventRendererHandle {
  const { client, target } = args;
  const frontendToolNames = args.frontendToolNames ?? new Set<string>();
  const interruptEventNames =
    args.interruptEventNames ?? new Set<string>(["on_interrupt"]);
  const showToolStatus = args.showToolStatus ?? false;
  const activityRenderers = args.renderActivityMessages ?? [];
  const agentId = args.agentId;
  /**
   * `activityMessageId → slackMessageTs` for activity messages we've
   * posted. A subsequent snapshot for the same messageId edits the
   * existing message instead of posting a new one — that's the
   * standard "live surface" pattern: the agent emits one activity
   * message per surface and re-emits snapshots as the surface state
   * changes.
   */
  const activityTs = new Map<string, string>();
  const toolStatusAllowed = (toolCallName: string): boolean => {
    if (frontendToolNames.has(toolCallName)) return false;
    if (showToolStatus === true) return true;
    if (Array.isArray(showToolStatus))
      return showToolStatus.includes(toolCallName);
    return false;
  };

  /** Per-AG-UI-message accumulated text (we accumulate deltas locally). */
  const buffers = new Map<string, string>();
  /** Per-AG-UI-message ChunkedMessageStream. Lazily created on first content. */
  const streams = new Map<string, ChunkedMessageStream>();
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

  /** Frontend-tool calls observed in this run, in event order. */
  const capturedToolCalls: CapturedToolCall[] = [];

  /**
   * Interrupt observed via a matching `onCustomEvent`. The React
   * `useInterrupt` pattern buffers locally and commits on run-finalize,
   * which we mirror via this single-slot variable — the turn-runner
   * reads it after `runAgent` resolves.
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
          const posted = await client.chat.postMessage({
            channel: target.channel,
            thread_ts: target.threadTs,
            text,
          });
          if (!posted.ts) throw new Error("postMessage returned no ts");
          return posted.ts;
        },
        updateAt: async (ts, text) => {
          await client.chat.update({ channel: target.channel, ts, text });
        },
        transform: displayTransform,
      });
      streams.set(messageId, s);
    }
    return s;
  };

  const subscriber: AgentSubscriber = {
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

    // ── 2. Tool-call surfacing ────────────────────────────────────────
    async onToolCallStartEvent({ event }) {
      if (aborted) return;
      // By default the bridge does NOT pre-announce tool calls — the
      // tool's output (a rendered component, a picker, the streamed
      // reply, etc.) is the affordance. Opt in via `showToolStatus`.
      // Also: dedup by toolCallId so a tool that re-emits START on
      // resume can't post a second status row.
      if (!toolStatusAllowed(event.toolCallName)) return;
      if (toolStatusTs.has(event.toolCallId)) return;
      try {
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
      // Only frontend-tool calls get captured here — the bridge will execute
      // them after the run finishes. We keep a single entry per
      // toolCallId, overwriting `toolCallArgs` as more args stream in.
      if (!frontendToolNames.has(toolCallName)) return;
      const existing = capturedToolCalls.find(
        (c) => c.toolCallId === event.toolCallId,
      );
      const args = (partialToolCallArgs ?? {}) as Record<string, unknown>;
      if (existing) {
        existing.toolCallArgs = args;
      } else {
        capturedToolCalls.push({
          toolCallId: event.toolCallId,
          toolCallName,
          toolCallArgs: args,
        });
      }
    },

    async onToolCallEndEvent({ event, toolCallName, toolCallArgs }) {
      if (aborted) return;
      // Frontend-tool: ensure we have a final entry with the fully-parsed
      // args (a tool with no `args` events will not have been recorded
      // by `onToolCallArgsEvent`).
      if (frontendToolNames.has(toolCallName)) {
        const existing = capturedToolCalls.find(
          (c) => c.toolCallId === event.toolCallId,
        );
        if (existing) {
          existing.toolCallArgs = (toolCallArgs ?? {}) as Record<
            string,
            unknown
          >;
        } else {
          capturedToolCalls.push({
            toolCallId: event.toolCallId,
            toolCallName,
            toolCallArgs: (toolCallArgs ?? {}) as Record<string, unknown>,
          });
        }
        return;
      }
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
      // here so downstream Zod validation always sees the parsed shape.
      let value = e.value;
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
          // Leave it as a string — the handler's Zod schema will reject
          // it explicitly with a clearer error.
        }
      }
      pendingInterrupt = { eventName: e.name, value };
    },

    // ── 4. Activity messages (A2UI surfaces + any custom activity type) ─
    async onActivitySnapshotEvent({ event }) {
      if (aborted) return;
      if (activityRenderers.length === 0) return;
      const renderer = selectActivityRenderer(
        activityRenderers,
        event.activityType,
        agentId,
      );
      if (!renderer) return;

      // Validate the content payload when the renderer ships a schema.
      // If parsing fails, log and skip — better than posting a broken
      // surface (or worse, crashing the run).
      let content: unknown = event.content;
      if (renderer.content) {
        const parsed = renderer.content.safeParse(event.content);
        if (!parsed.success) {
          console.warn(
            "[slack-renderer] activity '%s' content failed schema: %s",
            event.activityType,
            parsed.error?.message ?? "unknown error",
          );
          return;
        }
        content = parsed.data;
      }

      const activityMessage: ActivityMessage = {
        id: event.messageId,
        role: "activity",
        activityType: event.activityType,
        content: event.content as Record<string, unknown>,
      };

      let blocks;
      try {
        blocks = renderer.render({
          activityType: event.activityType,
          content,
          message: activityMessage,
        });
      } catch (err) {
        console.error("[slack-renderer] activity render threw:", err);
        return;
      }
      if (!blocks || blocks.length === 0) return;

      const existingTs = activityTs.get(event.messageId);
      const fallbackText = `[${event.activityType}]`;
      try {
        if (existingTs) {
          await client.chat.update({
            channel: target.channel,
            ts: existingTs,
            text: fallbackText,
            blocks,
          });
        } else {
          const posted = await client.chat.postMessage({
            channel: target.channel,
            thread_ts: target.threadTs,
            text: fallbackText,
            blocks,
          });
          if (posted.ts) activityTs.set(event.messageId, posted.ts);
        }
      } catch (err) {
        console.error("[slack-renderer] activity post/update failed:", err);
      }
    },

    // ── 5. Errors ─────────────────────────────────────────────────────
    async onRunErrorEvent({ event }) {
      // Don't post a warning if we're the ones aborting the run; the
      // `_(interrupted)_` marker on the partial reply is the user-visible
      // signal in that case.
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
