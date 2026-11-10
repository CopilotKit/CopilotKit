import { EventType } from "@ag-ui/core";
import type { BaseEvent } from "@ag-ui/core";
import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";
import type {
  CapturedInterrupt,
  CapturedToolCall,
  RunRenderer,
} from "@copilotkit/channels-core";
import type { LiveRun } from "./live-run.js";

export interface WebRunRendererArgs {
  /** The live response this run writes to, or `undefined` when none is open. */
  resolve: () => LiveRun | undefined;
  /** Custom event names treated as interrupts. */
  interruptEventNames: ReadonlySet<string>;
}

/**
 * Run renderer that forwards the agent's AG-UI events to the open web
 * response, as they arrive.
 *
 * The agent's own `RUN_STARTED`/`RUN_FINISHED` are not forwarded: the
 * response has one lifecycle around the whole turn, which can hold several
 * agent runs (a Channel tool call runs the agent again). An agent
 * `RUN_ERROR` makes the response end with `RUN_ERROR`.
 *
 * Channel tools run on the server between agent runs. Their results are in
 * the agent's messages but never pass through as events, so the renderer
 * emits a `TOOL_CALL_RESULT` for each one. Without it, the client history
 * would hold a tool call with no result.
 */
export function createWebRunRenderer(args: WebRunRendererArgs): RunRenderer {
  const captured: CapturedToolCall[] = [];
  let pendingInterrupt: CapturedInterrupt | undefined;
  let interrupted = false;
  /** Tool calls the client has seen. */
  const forwardedCalls = new Set<string>();
  /** Tool calls whose result the client has seen. */
  const sentResults = new Set<string>();
  /** The agent of the latest event. Its messages hold the Channel tool results. */
  let lastAgent: AbstractAgent | undefined;

  const send = (event: BaseEvent): boolean => {
    const live = args.resolve();
    return live ? live.emit(event) : false;
  };

  const flushToolResults = () => {
    if (!lastAgent) return;
    for (const message of lastAgent.messages) {
      if (message.role !== "tool") continue;
      const id = message.toolCallId;
      if (!forwardedCalls.has(id) || sentResults.has(id)) continue;
      const sent = send({
        type: EventType.TOOL_CALL_RESULT,
        messageId: message.id,
        toolCallId: id,
        content: message.content,
        role: "tool",
      } as BaseEvent);
      if (sent) sentResults.add(id);
    }
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
    onEvent({ event, agent }) {
      if (interrupted) return;
      lastAgent = agent;
      flushToolResults();
      switch (event.type) {
        case EventType.RUN_STARTED:
        case EventType.RUN_FINISHED:
          return;
        case EventType.RUN_ERROR: {
          const live = args.resolve();
          if (live) {
            live.innerError =
              (event as { message?: string }).message ?? "agent run failed";
          }
          return;
        }
        default:
          break;
      }
      const sent = send(event);
      if (!sent) return;
      if (event.type === EventType.TOOL_CALL_START) {
        forwardedCalls.add(
          (event as unknown as { toolCallId: string }).toolCallId,
        );
      } else if (event.type === EventType.TOOL_CALL_RESULT) {
        sentResults.add(
          (event as unknown as { toolCallId: string }).toolCallId,
        );
      }
    },
    onToolCallEndEvent({ event, toolCallName, toolCallArgs }) {
      if (interrupted) return;
      capture(
        event.toolCallId,
        toolCallName,
        (toolCallArgs ?? {}) as Record<string, unknown>,
      );
    },
    onCustomEvent({ event }) {
      if (interrupted) return;
      if (!args.interruptEventNames.has(event.name)) return;
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
  };

  return {
    subscriber,
    getCapturedToolCalls: () => captured,
    getPendingInterrupt: () => pendingInterrupt,
    clearPendingInterrupt: () => {
      pendingInterrupt = undefined;
    },
    async markInterrupted() {
      interrupted = true;
    },
    async finish() {
      if (interrupted) return;
      flushToolResults();
    },
  };
}
