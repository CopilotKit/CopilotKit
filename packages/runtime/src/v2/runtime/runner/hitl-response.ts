import type {
  BaseEvent,
  CustomEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import { EventType } from "@ag-ui/client";

/**
 * CUSTOM event names under this prefix are emitted only by the runtime.
 * Agent-emitted events that use it are dropped before persistence, so a
 * consumer of the durable event log can trust their origin.
 */
export const RESERVED_CUSTOM_EVENT_PREFIX = "copilotkit.";

/** Runtime-owned record of a user's answer to a human-in-the-loop step. */
export const HITL_RESPONSE_EVENT_NAME = "copilotkit.hitl_response";

/** How the user answered a human-in-the-loop step. */
export type HitlResponseOutcome = "approved" | "rejected" | "responded";

export interface HitlResponseValue {
  readonly toolCallId?: string;
  readonly interruptId?: string;
  readonly toolName?: string;
  readonly userId?: string;
  readonly outcome: HitlResponseOutcome;
}

export type HitlResponseEvent = CustomEvent & {
  readonly name: typeof HITL_RESPONSE_EVENT_NAME;
  readonly value: HitlResponseValue;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** True for a CUSTOM event in the runtime's reserved namespace. */
export function isReservedCustomEvent(event: BaseEvent): boolean {
  if (event.type !== EventType.CUSTOM) return false;
  const name = (event as BaseEvent & { name?: unknown }).name;
  return (
    typeof name === "string" && name.startsWith(RESERVED_CUSTOM_EVENT_PREFIX)
  );
}

function isHitlTool(tool: RunAgentInput["tools"][number]): boolean {
  const metadata = (tool as { metadata?: unknown }).metadata;
  return (
    isRecord(metadata) &&
    isRecord(metadata.copilotkit) &&
    metadata.copilotkit.interaction === "human-in-the-loop"
  );
}

const RESUME_OUTCOMES: Record<string, HitlResponseOutcome> = {
  resolved: "approved",
  cancelled: "rejected",
};

/**
 * Builds one runtime-owned response event per human-in-the-loop answer this
 * run carries: each new `tool` message answering a tool call whose tool is
 * flagged `metadata.copilotkit.interaction: "human-in-the-loop"`, and each
 * `resume[]` entry answering an interrupt.
 *
 * Only `persistedInputMessages` (the messages new to this run) are scanned,
 * so an answer already recorded by an earlier run is not recorded again. The
 * tool call's name is looked up across the full `input.messages`, because the
 * assistant message that made the call is usually already in history.
 */
export function buildHitlResponseEvents(params: {
  input: RunAgentInput;
  persistedInputMessages?: Message[];
  userId?: string;
}): HitlResponseEvent[] {
  const { input, userId } = params;
  const identity = userId !== undefined ? { userId } : {};
  const events: HitlResponseEvent[] = [];
  const event = (value: HitlResponseValue): HitlResponseEvent => ({
    type: EventType.CUSTOM,
    name: HITL_RESPONSE_EVENT_NAME,
    value,
  });

  const hitlToolNames = new Set(
    (input.tools ?? []).filter(isHitlTool).map((tool) => tool.name),
  );
  if (hitlToolNames.size > 0) {
    const toolCallNames = new Map<string, string>();
    for (const message of input.messages ?? []) {
      if (message.role !== "assistant") continue;
      for (const call of message.toolCalls ?? []) {
        toolCallNames.set(call.id, call.function.name);
      }
    }
    for (const message of params.persistedInputMessages ??
      input.messages ??
      []) {
      if (message.role !== "tool") continue;
      const toolName = toolCallNames.get(message.toolCallId);
      if (toolName === undefined || !hitlToolNames.has(toolName)) continue;
      events.push(
        event({
          toolCallId: message.toolCallId,
          toolName,
          ...identity,
          outcome: "responded",
        }),
      );
    }
  }

  for (const resume of input.resume ?? []) {
    const outcome = RESUME_OUTCOMES[resume.status];
    if (outcome === undefined) continue;
    events.push(
      event({ interruptId: resume.interruptId, ...identity, outcome }),
    );
  }

  return events;
}
