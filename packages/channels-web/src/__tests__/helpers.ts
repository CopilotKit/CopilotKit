import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { from } from "rxjs";
import type { Observable } from "rxjs";

export type ScriptStep = (input: RunAgentInput) => BaseEvent[];

/**
 * A real `AbstractAgent` whose `run()` replays scripted events, so the AG-UI
 * client pipeline (verify, apply, subscribers) runs exactly as in production.
 * Clones share one script queue, because Channels clones the agent per turn.
 */
export class ScriptedAgent extends AbstractAgent {
  readonly inputs: RunAgentInput[];

  constructor(
    private readonly queue: ScriptStep[],
    inputs: RunAgentInput[] = [],
  ) {
    super({ agentId: "scripted" });
    this.inputs = inputs;
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.inputs.push(structuredClone(input));
    const step = this.queue.shift();
    const body = step ? step(input) : [];
    return from([
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      ...body,
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    ] as BaseEvent[]);
  }

  override clone(): ScriptedAgent {
    const cloned = new ScriptedAgent(this.queue, this.inputs);
    cloned.threadId = this.threadId;
    cloned.messages = structuredClone(this.messages);
    return cloned;
  }
}

export function textReply(messageId: string, text: string): BaseEvent[] {
  return [
    { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text },
    { type: EventType.TEXT_MESSAGE_END, messageId },
  ] as BaseEvent[];
}

export function toolCall(
  toolCallId: string,
  toolCallName: string,
  args: unknown,
): BaseEvent[] {
  return [
    {
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName,
      parentMessageId: `${toolCallId}-msg`,
    },
    {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta: JSON.stringify(args),
    },
    { type: EventType.TOOL_CALL_END, toolCallId },
  ] as BaseEvent[];
}

/** Parse an SSE response body into AG-UI events. */
export async function readEvents(response: Response): Promise<BaseEvent[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .map((frame) => frame.trim())
    .filter((frame) => frame.startsWith("data:"))
    .map(
      (frame) => JSON.parse(frame.slice("data:".length).trim()) as BaseEvent,
    );
}
