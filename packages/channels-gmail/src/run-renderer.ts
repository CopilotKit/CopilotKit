import type { AgentSubscriber } from "@ag-ui/client";
import type {
  CapturedInterrupt,
  CapturedToolCall,
  RunRenderer,
} from "@copilotkit/channels-core";

export interface GmailRunRendererArgs {
  /** Send the whole reply as one email. */
  send: (markdown: string) => Promise<void>;
  /** Custom event names treated as interrupts. */
  interruptEventNames: ReadonlySet<string>;
}

/**
 * Run renderer that collects the agent's text for the whole turn and sends
 * it as one email when the turn ends. Email cannot stream or edit, so every
 * text message of every agent run in the turn goes into one reply.
 *
 * A run error sends what was collected so far with an error note. An
 * interrupt sends what was collected so far.
 */
export function createGmailRunRenderer(
  args: GmailRunRendererArgs,
): RunRenderer {
  const captured: CapturedToolCall[] = [];
  const order: string[] = [];
  const texts = new Map<string, string>();
  let pendingInterrupt: CapturedInterrupt | undefined;
  let done = false;

  const append = (messageId: string, delta: string) => {
    if (!texts.has(messageId)) {
      order.push(messageId);
      texts.set(messageId, "");
    }
    texts.set(messageId, texts.get(messageId)! + delta);
  };

  const flush = async (note?: string) => {
    if (done) return;
    done = true;
    const body = order
      .map((id) => texts.get(id)!.trim())
      .filter((t) => t.length > 0);
    if (note) body.push(note);
    if (body.length === 0) return;
    await args.send(body.join("\n\n"));
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

  const subscriber: AgentSubscriber = {
    onTextMessageStartEvent({ event }) {
      if (!done) append(event.messageId, "");
    },
    onTextMessageContentEvent({ event }) {
      if (!done) append(event.messageId, event.delta ?? "");
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
    async onRunErrorEvent({ event }) {
      // The error text can hold internals, so the email gets a generic note.
      console.error("[channels-gmail] agent run failed:", event.message);
      await flush("(Sorry, something went wrong while answering.)");
    },
  };

  return {
    subscriber,
    getCapturedToolCalls: () => captured,
    getPendingInterrupt: () => pendingInterrupt,
    clearPendingInterrupt: () => {
      pendingInterrupt = undefined;
    },
    markInterrupted: () => flush(),
    finish: () => flush(),
  };
}
