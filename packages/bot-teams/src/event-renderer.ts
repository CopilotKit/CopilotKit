import type { AgentSubscriber } from "@ag-ui/client";
import type {
  RunRenderer,
  CapturedToolCall,
  CapturedInterrupt,
} from "@copilotkit/bot";
import { TeamsMessageStream } from "./message-stream.js";
import { autoCloseOpenMarkdown } from "./render/auto-close.js";

const INTERRUPTED_SUFFIX = "\n\n_(interrupted)_";

/**
 * Build a {@link RunRenderer} for a single agent run in Teams.
 *
 * Each AG-UI text message is **streamed by message edit**: on the first content
 * delta we post a Teams message (after a typing indicator), then `updateActivity`
 * it as the text grows (throttled), and finalize on message-end. This is Teams'
 * baseline streaming model (see {@link TeamsMessageStream}). Tool calls and
 * interrupts are captured for the run-loop to read after `runAgent` resolves,
 * exactly as the Slack adapter does.
 */
export function createRunRenderer(args: {
  /** First send for a streamed message. Returns the posted activity id. */
  post: (text: string) => Promise<string>;
  /** Edit a previously-posted streamed message. */
  update: (id: string, text: string) => Promise<void>;
  /** Optional typing indicator, fired once before a message's first post. */
  typing?: () => Promise<void>;
  interruptEventNames?: ReadonlySet<string>;
  /** Persist the agent's reply text to the conversation transcript. */
  recordAssistant?: (text: string) => void;
}): RunRenderer {
  const interruptEventNames =
    args.interruptEventNames ?? new Set<string>(["on_interrupt"]);

  /** Per-AG-UI-message accumulated text + its streamed-by-edit message. */
  const buffers = new Map<string, string>();
  const streams = new Map<string, TeamsMessageStream>();
  const capturedToolCalls: CapturedToolCall[] = [];
  let pendingInterrupt: CapturedInterrupt | undefined;
  let aborted = false;

  const streamFor = (messageId: string): TeamsMessageStream => {
    let s = streams.get(messageId);
    if (!s) {
      s = new TeamsMessageStream({
        post: args.post,
        update: args.update,
        typing: args.typing,
      });
      streams.set(messageId, s);
    }
    return s;
  };

  const captureToolCall = (
    toolCallId: string,
    toolCallName: string,
    toolCallArgs: Record<string, unknown>,
  ): void => {
    const existing = capturedToolCalls.find((c) => c.toolCallId === toolCallId);
    if (existing) {
      existing.toolCallName = toolCallName;
      existing.toolCallArgs = toolCallArgs;
    } else {
      capturedToolCalls.push({ toolCallId, toolCallName, toolCallArgs });
    }
  };

  const subscriber: AgentSubscriber = {
    onTextMessageStartEvent({ event }) {
      if (aborted) return;
      buffers.set(event.messageId, "");
      streamFor(event.messageId);
    },
    onTextMessageContentEvent({ event }) {
      if (aborted) return;
      const next = (buffers.get(event.messageId) ?? "") + (event.delta ?? "");
      buffers.set(event.messageId, next);
      // Mid-stream the buffer is usually unbalanced markdown (an open `**`,
      // code fence, etc.); balance it for display so the edited message never
      // renders broken. The finalized message uses the raw text (below).
      streamFor(event.messageId).append(autoCloseOpenMarkdown(next));
    },
    async onTextMessageEndEvent({ event }) {
      if (aborted) return;
      const text = buffers.get(event.messageId) ?? "";
      buffers.delete(event.messageId);
      // Commit the agent's exact final text (now balanced on its own) so the
      // settled message carries no synthetic closers.
      const stream = streamFor(event.messageId);
      stream.append(text);
      await stream.finish();
      streams.delete(event.messageId);
      const trimmed = text.trim();
      if (trimmed) args.recordAssistant?.(trimmed);
    },

    onToolCallArgsEvent({ event, toolCallName, partialToolCallArgs }) {
      if (aborted) return;
      captureToolCall(
        event.toolCallId,
        toolCallName,
        (partialToolCallArgs ?? {}) as Record<string, unknown>,
      );
    },
    onToolCallEndEvent({ event, toolCallName, toolCallArgs }) {
      if (aborted) return;
      captureToolCall(
        event.toolCallId,
        toolCallName,
        (toolCallArgs ?? {}) as Record<string, unknown>,
      );
    },

    onCustomEvent({ event }) {
      if (aborted) return;
      const e = event as { name?: string; value?: unknown };
      if (!e.name || !interruptEventNames.has(e.name)) return;
      let value = e.value;
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
          // Leave as a string. The handler's schema rejects it explicitly.
        }
      }
      pendingInterrupt = { eventName: e.name, value };
    },

    async onRunErrorEvent({ event }) {
      if (aborted) return;
      await args.post(`⚠️ Agent error: ${event.message ?? "unknown error"}`);
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
      // Flush any partial reply with a marker so the user sees the run stopped.
      const tasks: Promise<unknown>[] = [];
      for (const [id, buf] of Array.from(buffers.entries())) {
        const s = streams.get(id);
        if (s && buf.length > 0) {
          // Balance the partial buffer so the interrupted marker reads cleanly.
          s.append(autoCloseOpenMarkdown(buf) + INTERRUPTED_SUFFIX);
          tasks.push(s.finish());
        }
        buffers.delete(id);
        streams.delete(id);
      }
      await Promise.all(tasks);
    },
  };
}
