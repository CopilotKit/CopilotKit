import type { AgentSubscriber } from "@ag-ui/client";
import type {
  RunRenderer,
  CapturedToolCall,
  CapturedInterrupt,
} from "@copilotkit/bot";
import { ChunkedMessageStream } from "./chunked-message-stream.js";
import { markdownToChat } from "./markdown.js";
import { TOOL_STATUS_PREFIXES } from "./status-markers.js";
import type { ChatClient } from "./chat-client.js";
import type { ReplyTarget } from "./types.js";

const INTERRUPTED_SUFFIX = "\n_(interrupted)_";

// Tool-status row prefixes, sourced from the shared single source of truth so
// the emitter here and the history filter in `status-markers.ts` can't drift.
const [TOOL_START_PREFIX, TOOL_END_PREFIX, TOOL_INTERRUPT_PREFIX] =
  TOOL_STATUS_PREFIXES;

/**
 * Construct a {@link RunRenderer} for a single agent run in Google Chat.
 *
 * Streams agent text into an edit-in-place Google Chat message via
 * `ChunkedMessageStream`. Tool-status rows post as plain-text messages
 * (behind `showToolStatus`). Interrupt capture mirrors the Slack adapter.
 */
export function createRunRenderer(args: {
  client: ChatClient;
  target: ReplyTarget;
  /**
   * Custom-event names that should be treated as interrupts. Defaults to
   * `on_interrupt` (the name LangGraph's AG-UI adapter emits).
   */
  interruptEventNames?: ReadonlySet<string>;
  /**
   * Whether tool calls should surface as `🔧 \`tool\`…` → `✅ \`tool\``
   * status rows in the thread. Defaults to `true`.
   */
  showToolStatus?: boolean;
}): RunRenderer {
  const { client, target } = args;
  const interruptEventNames =
    args.interruptEventNames ?? new Set<string>(["on_interrupt"]);
  const showToolStatus = args.showToolStatus ?? true;

  /** Per-AG-UI-message accumulated text (we accumulate deltas locally). */
  const buffers = new Map<string, string>();
  /** Per-AG-UI-message chunked stream. Lazily created on first content. */
  const streams = new Map<string, ChunkedMessageStream>();
  /** Per-tool-call Google Chat message name so we can patch it on END. */
  const toolStatusName = new Map<string, string>();
  /**
   * Once a stream has been finalised (either via TEXT_MESSAGE_END or via
   * markInterrupted), we drop it. Late-arriving events for the same
   * messageId are ignored.
   */
  const finalised = new Set<string>();
  /**
   * Set when the caller intentionally aborted the run (i.e. a new turn
   * arrived for the same conversation). Suppresses further AG-UI events.
   */
  let aborted = false;

  /** Tool calls observed in this run, in event order. */
  const capturedToolCalls: CapturedToolCall[] = [];

  /**
   * Interrupt observed via a matching `onCustomEvent`. The run-loop reads
   * it after `runAgent` resolves.
   */
  let pendingInterrupt: CapturedInterrupt | undefined;

  const makeChatStream = (): ChunkedMessageStream =>
    new ChunkedMessageStream({
      postPlaceholder: async (text) => {
        const msg = await client.createMessage(
          target.space,
          { text },
          { threadName: target.thread, replyToThread: !!target.thread },
        );
        return msg.name;
      },
      updateAt: async (name, text) => {
        await client.patchMessage(name, { text }, "text");
      },
      transform: markdownToChat,
    });

  const ensureStream = (messageId: string): ChunkedMessageStream | undefined => {
    if (finalised.has(messageId)) return undefined;
    let s = streams.get(messageId);
    if (!s) {
      s = makeChatStream();
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
      // Capture the tool name early so an interrupt can label a dangling
      // status row even if no ARGS/END event ever arrives.
      captureToolCall(event.toolCallId, event.toolCallName, {});
      if (!showToolStatus) return;
      // Dedup by toolCallId so a tool that re-emits START on resume can't
      // post a second status row.
      if (toolStatusName.has(event.toolCallId)) return;
      try {
        const msg = await client.createMessage(
          target.space,
          { text: `${TOOL_START_PREFIX}\`${event.toolCallName}\`…` },
          { threadName: target.thread, replyToThread: !!target.thread },
        );
        toolStatusName.set(event.toolCallId, msg.name);
      } catch (err) {
        console.error("[gchat-renderer] tool-start post failed:", err);
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
      const name = toolStatusName.get(event.toolCallId);
      if (!name) return;
      try {
        await client.patchMessage(
          name,
          { text: `${TOOL_END_PREFIX}\`${toolCallName}\`` },
          "text",
        );
      } catch (err) {
        console.error("[gchat-renderer] tool-end patch failed:", err);
      }
      toolStatusName.delete(event.toolCallId);
    },

    // ── 3. Interrupts (LangGraph `interrupt()` → AG-UI custom event) ──
    onCustomEvent({ event }) {
      if (aborted) return;
      const e = event as { name?: string; value?: unknown };
      if (!e.name || !interruptEventNames.has(e.name)) return;
      let value = e.value;
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
          // Leave as string — handler's schema will reject with a clear error.
        }
      }
      pendingInterrupt = { eventName: e.name, value };
    },

    // ── 4. Errors ─────────────────────────────────────────────────────
    async onRunErrorEvent({ event }) {
      if (aborted) return;
      try {
        await client.createMessage(
          target.space,
          { text: `⚠️ Agent error: ${event.message ?? "unknown error"}` },
          { threadName: target.thread, replyToThread: !!target.thread },
        );
      } catch (err) {
        console.error("[gchat-renderer] error notice failed:", err);
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
      if (aborted) return;
      aborted = true;
      const tasks: Promise<void>[] = [];
      for (const [id, stream] of Array.from(streams.entries())) {
        const buf = buffers.get(id) ?? "";
        // Only append the interrupted suffix for streams that have actually
        // posted content. A non-empty buffer means `ChunkedMessageStream`
        // already posted a `_thinking…_` placeholder, so we resolve it by
        // appending the suffix and finishing. An empty/whitespace buffer
        // never posted a placeholder (dispatch early-returns on an empty
        // buffer), so appending the suffix would make the buffer non-empty
        // and trigger a *spurious* placeholder post — instead we just
        // finish() (a true no-op for an empty stream) without appending.
        if (buf.trim().length > 0) {
          stream.append(buf + INTERRUPTED_SUFFIX);
        }
        tasks.push(stream.finish());
        streams.delete(id);
        finalised.add(id);
      }
      // Flip any outstanding tool-status rows (START posted, END never
      // arrived) to a terminal marker so they don't dangle as `🔧 …` rows.
      // Mirrors the `onToolCallEndEvent` patch (same `patchMessage` mask).
      for (const [toolCallId, name] of Array.from(toolStatusName.entries())) {
        const label =
          capturedToolCalls.find((c) => c.toolCallId === toolCallId)
            ?.toolCallName ?? toolCallId;
        tasks.push(
          (async () => {
            try {
              await client.patchMessage(
                name,
                { text: `${TOOL_INTERRUPT_PREFIX}\`${label}\`` },
                "text",
              );
            } catch (err) {
              console.error("[gchat-renderer] tool-interrupt patch failed:", err);
            }
          })(),
        );
        toolStatusName.delete(toolCallId);
      }
      buffers.clear();
      await Promise.all(tasks);
    },
  };
}
