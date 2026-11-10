import type { AgentSubscriber, ToolCallResultEvent } from "@ag-ui/client";
import type {
  CapturedInterrupt,
  CapturedToolCall,
  RunRenderer,
} from "@copilotkit/channels-core";
import type { CreateActivityOptions, LinearApiClient } from "./client.js";
import { LINEAR_LIMITS, truncateText } from "./render/budget.js";
import type { AgentActivityContent, ReplyTarget } from "./types.js";

/** Max chars of the one-line argument summary shown as an action's `parameter`. */
const ACTION_PARAMETER_MAX = 200;

export interface LinearRunRendererArgs {
  /** Client that posts the activities. Only `createActivity` is used. */
  client: Pick<LinearApiClient, "createActivity">;
  /** The agent session that receives the activities. */
  target: ReplyTarget;
  /** Custom-event names treated as interrupts. Defaults to {"on_interrupt"}. */
  interruptEventNames?: ReadonlySet<string>;
}

/** The renderer `createRunRenderer` returns. */
export interface LinearRunRenderer extends RunRenderer {
  /** Wait until every queued activity is posted (or has failed). */
  finish(): Promise<void>;
  /** The first `createActivity` failure of this run, or `undefined`. */
  getDeliveryError(): unknown;
}

/**
 * Run renderer for Linear. Linear agent activities cannot be edited, so the
 * renderer buffers each AG-UI message and posts it once when it ends:
 * - text message -> `response` (split into more activities when too long)
 * - reasoning message -> ephemeral `thought`
 * - tool call end -> `action` with a one-line argument summary
 * - tool call result -> `action` again, with `result`
 * - run error -> `error`
 *
 * All posts run on one promise chain, so activities appear in event order.
 * A failed post is logged and never thrown out of a subscriber hook. The
 * first failure is kept for {@link LinearRunRenderer.getDeliveryError}.
 *
 * Tool-call and interrupt capture match the other channel renderers, so the
 * run-loop reads them the same way.
 *
 * @example
 * const renderer = createRunRenderer({ client, target });
 * await agent.runAgent({}, renderer.subscriber);
 * await renderer.finish();
 */
export function createRunRenderer(args: LinearRunRendererArgs) {
  const { client, target } = args;
  const interruptEventNames =
    args.interruptEventNames ?? new Set<string>(["on_interrupt"]);
  const textBuffers = new Map<string, string>();
  const reasoningBuffers = new Map<string, string>();
  const toolCallActions = new Map<
    string,
    { action: string; parameter: string }
  >();
  const capturedToolCalls: CapturedToolCall[] = [];
  let pendingInterrupt: CapturedInterrupt | undefined;
  let deliveryError: unknown;
  let aborted = false;
  let chain = Promise.resolve();

  const post = (
    content: AgentActivityContent,
    options: CreateActivityOptions = {},
  ) => {
    chain = chain.then(async () => {
      if (aborted) return;
      try {
        await client.createActivity(target.agentSessionId, content, options);
      } catch (error) {
        deliveryError ??= error;
        console.error(
          `[channels-linear] failed to post a "${content.type}" activity to session ${target.agentSessionId}`,
          error,
        );
      }
    });
    return chain;
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
    onTextMessageStartEvent({ event }) {
      if (aborted) return;
      textBuffers.set(event.messageId, "");
    },
    onTextMessageContentEvent({ event }) {
      if (aborted) return;
      appendDelta(textBuffers, event.messageId, event.delta);
    },
    async onTextMessageEndEvent({ event }) {
      if (aborted) return;
      const text = textBuffers.get(event.messageId) ?? "";
      textBuffers.delete(event.messageId);
      // Queue every part now, so no other event lands between the parts.
      const bodies = splitBody(text, LINEAR_LIMITS.activityBody);
      for (const body of bodies) {
        void post({ type: "response", body });
      }
      await chain;
    },
    onReasoningMessageStartEvent({ event }) {
      if (aborted) return;
      reasoningBuffers.set(event.messageId, "");
    },
    onReasoningMessageContentEvent({ event }) {
      if (aborted) return;
      appendDelta(reasoningBuffers, event.messageId, event.delta);
    },
    async onReasoningMessageEndEvent({ event }) {
      if (aborted) return;
      const text = reasoningBuffers.get(event.messageId) ?? "";
      reasoningBuffers.delete(event.messageId);
      if (text.trim().length === 0) return;
      await post(
        {
          type: "thought",
          body: truncateText(text, LINEAR_LIMITS.activityBody),
        },
        { ephemeral: true },
      );
    },
    onToolCallArgsEvent({ event, toolCallName, partialToolCallArgs }) {
      if (aborted) return;
      captureToolCall(
        event.toolCallId,
        toolCallName,
        partialToolCallArgs ?? {},
      );
    },
    async onToolCallEndEvent({ event, toolCallName, toolCallArgs }) {
      if (aborted) return;
      const callArgs = toolCallArgs ?? {};
      captureToolCall(event.toolCallId, toolCallName, callArgs);
      const action = {
        action: toolCallName,
        parameter: summarizeArgs(callArgs),
      };
      toolCallActions.set(event.toolCallId, action);
      await post({ type: "action", ...action });
    },
    async onToolCallResultEvent({ event }) {
      if (aborted) return;
      const action = toolCallActions.get(event.toolCallId);
      if (!action) return;
      const result = truncateText(
        toolResultText(event.content),
        LINEAR_LIMITS.activityBody,
      );
      await post({ type: "action", ...action, result });
    },
    onCustomEvent({ event }) {
      if (aborted) return;
      if (!event.name || !interruptEventNames.has(event.name)) return;
      let value: unknown = event.value;
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
          /* leave as string; downstream schema will reject explicitly */
        }
      }
      pendingInterrupt = { eventName: event.name, value };
    },
    async onRunErrorEvent({ event }) {
      if (aborted) return;
      const body = truncateText(
        event.message || "unknown error",
        LINEAR_LIMITS.activityBody,
      );
      await post({ type: "error", body });
    },
  };

  const renderer = {
    subscriber,
    getCapturedToolCalls: () => capturedToolCalls,
    getPendingInterrupt: () => pendingInterrupt,
    clearPendingInterrupt: () => {
      pendingInterrupt = undefined;
    },
    /**
     * Stop posting. Queued activities are dropped and later events post
     * nothing; Linear already shows the user's stop in the session.
     */
    async markInterrupted() {
      aborted = true;
      textBuffers.clear();
      reasoningBuffers.clear();
      await chain;
    },
    /** Wait until every queued activity is posted (or has failed). */
    async finish() {
      await chain;
    },
    /** The first `createActivity` failure of this run, or `undefined`. */
    getDeliveryError: () => deliveryError,
  } satisfies LinearRunRenderer;
  return renderer;
}

function appendDelta(
  buffers: Map<string, string>,
  messageId: string,
  delta: string,
) {
  buffers.set(messageId, (buffers.get(messageId) ?? "") + delta);
}

/**
 * Split `text` into bodies of at most `max` chars, so a long reply posts as
 * several activities instead of losing text. Cuts at the last newline in the
 * window when there is one. Empty text gives no bodies.
 */
function splitBody(text: string, max: number) {
  const bodies: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const newline = rest.lastIndexOf("\n", max);
    const cut = newline > 0 ? newline : max;
    bodies.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest.trim().length > 0) bodies.push(rest);
  return bodies;
}

/** One-line summary of tool arguments for an action's `parameter`. */
function summarizeArgs(toolArgs: Record<string, unknown>) {
  const isEmpty = Object.keys(toolArgs).length === 0;
  if (isEmpty) return "";
  return truncateText(JSON.stringify(toolArgs), ACTION_PARAMETER_MAX);
}

function toolResultText(content: ToolCallResultEvent["content"]) {
  if (typeof content === "string") return content;
  return content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}
