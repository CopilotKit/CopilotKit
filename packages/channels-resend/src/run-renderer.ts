import type { AgentSubscriber } from "@ag-ui/client";
import type {
  CapturedInterrupt,
  CapturedToolCall,
  RunRenderer,
} from "@copilotkit/channels-core";

/** Shown in place of the reply when the agent run fails. Internal error text is not emailed. */
export const AGENT_ERROR_TEXT =
  "Sorry, something went wrong while writing this reply.";

export interface EmailRunRendererArgs {
  /** Send the finished reply as one email. */
  send: (text: string) => Promise<void>;
  /** Custom event names treated as interrupts. */
  interruptEventNames: ReadonlySet<string>;
}

/**
 * Run renderer for email. Email cannot stream or edit, so the renderer
 * collects every assistant text message of the turn (a turn can hold
 * several agent runs when Channel tools run) and sends them as one email
 * when the turn ends. On an interrupt it sends what it has so far.
 */
export function createEmailRunRenderer(
  args: EmailRunRendererArgs,
): RunRenderer {
  const order: string[] = [];
  const texts = new Map<string, string>();
  const captured: CapturedToolCall[] = [];
  let pendingInterrupt: CapturedInterrupt | undefined;
  let failed = false;
  let done = false;

  const append = (messageId: string, delta: string) => {
    if (!texts.has(messageId)) {
      order.push(messageId);
      texts.set(messageId, "");
    }
    texts.set(messageId, texts.get(messageId)! + delta);
  };

  const capture = (
    toolCallId: string,
    toolCallName: string,
    toolCallArgs: Record<string, unknown>,
  ) => {
    const existing = captured.find((c) => c.toolCallId === toolCallId);
    if (existing) {
      existing.toolCallName = toolCallName;
      existing.toolCallArgs = toolCallArgs;
    } else {
      captured.push({ toolCallId, toolCallName, toolCallArgs });
    }
  };

  const flush = async () => {
    if (done) return;
    done = true;
    const parts = order
      .map((id) => texts.get(id)!.trim())
      .filter((text) => text.length > 0);
    if (failed) parts.push(AGENT_ERROR_TEXT);
    if (parts.length === 0) return;
    await args.send(parts.join("\n\n"));
  };

  const subscriber: AgentSubscriber = {
    onTextMessageStartEvent({ event }) {
      if (done) return;
      append(event.messageId, "");
    },
    onTextMessageContentEvent({ event }) {
      if (done) return;
      append(event.messageId, event.delta ?? "");
    },
    onToolCallEndEvent({ event, toolCallName, toolCallArgs }) {
      if (done) return;
      capture(
        event.toolCallId,
        toolCallName,
        (toolCallArgs ?? {}) as Record<string, unknown>,
      );
    },
    onCustomEvent({ event }) {
      if (done || !args.interruptEventNames.has(event.name)) return;
      let value: unknown = event.value;
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
          // Keep the string; the interrupt handler decides what it means.
        }
      }
      pendingInterrupt = { eventName: event.name, value };
    },
    onRunErrorEvent() {
      if (done) return;
      failed = true;
    },
  };

  return {
    subscriber,
    getCapturedToolCalls: () => captured,
    getPendingInterrupt: () => pendingInterrupt,
    clearPendingInterrupt: () => {
      pendingInterrupt = undefined;
    },
    markInterrupted: flush,
    finish: flush,
  };
}
