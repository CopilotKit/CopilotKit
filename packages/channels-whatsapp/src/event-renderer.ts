import type { AgentSubscriber } from "@ag-ui/client";
import type {
  RunRenderer,
  CapturedToolCall,
  CapturedInterrupt,
} from "@copilotkit/channels";

const INTERRUPTED_SUFFIX = "\n_(interrupted)_";

export interface RunRendererArgs {
  /** Send a finished text message to the conversation (the adapter wires the Cloud API client). */
  send: (text: string) => Promise<void>;
  /** Persist the assistant's final text to the HistoryStore. */
  onAssistantText?: (text: string) => void;
  /** Custom-event names treated as interrupts. Defaults to {"on_interrupt"}. */
  interruptEventNames?: ReadonlySet<string>;
}

/**
 * Buffered run renderer for WhatsApp. Unlike Slack's streaming renderer, this
 * accumulates text deltas and sends the full message only on TEXT_MESSAGE_END
 * (WhatsApp messages are immutable — there is no chat.update). Tool-call and
 * interrupt capture mirror the Slack renderer so the engine's run-loop reads
 * them identically.
 */
export function createRunRenderer(args: RunRendererArgs): RunRenderer {
  const interruptEventNames =
    args.interruptEventNames ?? new Set<string>(["on_interrupt"]);
  const buffers = new Map<string, string>();
  const finalised = new Set<string>();
  const capturedToolCalls: CapturedToolCall[] = [];
  let pendingInterrupt: CapturedInterrupt | undefined;
  let aborted = false;

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

  const flush = async (text: string) => {
    if (!text) return;
    await args.send(text);
    args.onAssistantText?.(text);
  };

  const subscriber: AgentSubscriber = {
    onTextMessageStartEvent({ event }) {
      if (aborted) return;
      buffers.set(event.messageId, "");
    },
    onTextMessageContentEvent({ event }) {
      if (aborted || finalised.has(event.messageId)) return;
      buffers.set(
        event.messageId,
        (buffers.get(event.messageId) ?? "") + (event.delta ?? ""),
      );
    },
    async onTextMessageEndEvent({ event }) {
      if (aborted || finalised.has(event.messageId)) return;
      const text = buffers.get(event.messageId) ?? "";
      buffers.delete(event.messageId);
      finalised.add(event.messageId);
      await flush(text);
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
          /* leave as string; downstream schema will reject explicitly */
        }
      }
      pendingInterrupt = { eventName: e.name, value };
    },
    async onRunErrorEvent({ event }) {
      if (aborted) return;
      try {
        await args.send(`⚠️ Agent error: ${event.message ?? "unknown error"}`);
      } catch {
        /* best-effort */
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
      for (const [id, buf] of Array.from(buffers.entries())) {
        if (buf.length > 0) tasks.push(flush(buf + INTERRUPTED_SUFFIX));
        finalised.add(id);
      }
      buffers.clear();
      await Promise.all(tasks);
    },
  };
}
