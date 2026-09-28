import type {
  BaseEvent,
  CustomEvent,
  Message,
  ResumeEntry,
  RunAgentInput,
} from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import type { ThreadMessage } from "../intelligence-platform/client";

/**
 * CUSTOM event names under this prefix are emitted only by the runtime.
 * Agent-emitted events that use it are dropped before persistence, so a
 * consumer of the durable event log can trust their origin.
 */
export const RESERVED_CUSTOM_EVENT_PREFIX = "copilotkit.";

/** Runtime-owned record of a user's answer to a human-in-the-loop step. */
export const HITL_RESPONSE_EVENT_NAME = "copilotkit.hitl_response";

/**
 * How the user answered a human-in-the-loop step.
 *
 * - `responded`: the user answered. The answer's meaning belongs to the app,
 *   so the runtime does not guess whether it was a yes or a no. Every
 *   human-in-the-loop tool result is recorded this way.
 * - `approved` / `rejected`: the user resolved an interrupt with an object
 *   payload whose `approved` field is a boolean (`resolve({ approved: true })`
 *   or `resolve({ approved: false })`). This is the one approval convention
 *   the runtime recognises; any other payload is recorded as `responded`.
 * - `cancelled`: the interrupt was dismissed with `cancel()` rather than
 *   answered. A dismissal is not necessarily a rejection.
 */
export type HitlResponseOutcome =
  | "approved"
  | "rejected"
  | "responded"
  | "cancelled";

export interface HitlResponseValue {
  readonly toolCallId?: string;
  readonly interruptId?: string;
  readonly toolName?: string;
  readonly userId?: string;
  readonly outcome: HitlResponseOutcome;
  /**
   * True when the runtime confirmed `toolCallId` against the thread's
   * server-side history: the agent made that call to `toolName` in an
   * earlier run and history holds no answer to it yet. False for an
   * interrupt answer the runtime could not tie to such a call; the runtime
   * has no server-side view of a thread's open interrupts, so the consumer
   * must check `interruptId` against the run that raised it.
   */
  readonly verified: boolean;
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

/**
 * Maps one `resume[]` entry to its outcome. `resolved` only says the user
 * answered, so it becomes `approved` or `rejected` only when the payload
 * states approval as a boolean `approved` field; otherwise `responded`.
 */
function resumeOutcome(resume: ResumeEntry): HitlResponseOutcome | undefined {
  if (resume.status === "cancelled") return "cancelled";
  if (resume.status !== "resolved") return undefined;
  const payload: unknown = resume.payload;
  if (isRecord(payload) && typeof payload.approved === "boolean") {
    return payload.approved ? "approved" : "rejected";
  }
  return "responded";
}

/** Most answer records one run may create; the rest are dropped. */
export const MAX_HITL_RESPONSES_PER_RUN = 100;

/** Longest interrupt ID recorded; longer ones are not real interrupt IDs. */
const MAX_INTERRUPT_ID_LENGTH = 256;

function resumeToolCallId(resume: ResumeEntry): string | undefined {
  const metadata: unknown = resume.metadata;
  if (!isRecord(metadata)) return undefined;
  const toolCallId = metadata.toolCallId;
  return typeof toolCallId === "string" && toolCallId.length > 0
    ? toolCallId
    : undefined;
}

/**
 * Builds one runtime-owned response event per human-in-the-loop answer this
 * run carries (see {@link HitlResponseOutcome} for the outcomes).
 *
 * Client input is not trusted to say what was asked. A tool call counts only
 * when the thread's server-side history (`historyMessages`) shows the agent
 * made it and holds no answer to it yet, and its name comes from that
 * history. The human-in-the-loop flag comes from this run's `input.tools`:
 * the frontend owns its tools and executes them itself, so it is the
 * authority on which of them ask the user.
 *
 * - A `resume[]` entry answering an interrupt is recorded once per interrupt
 *   ID. When it names a tool call (`metadata.toolCallId`, set by core for
 *   `tool_call` interrupts) that history confirms, the record carries that
 *   call and `verified: true`; otherwise the call ID is dropped and the
 *   record is `verified: false`.
 * - A new `tool` message answering a flagged tool call is recorded as
 *   `responded`, unless a resume entry already recorded that call.
 *
 * With no history (`historyMessages` absent) no tool call can be confirmed,
 * so only unverified interrupt answers are recorded. At most
 * {@link MAX_HITL_RESPONSES_PER_RUN} records are built per run.
 */
export function buildHitlResponseEvents(params: {
  input: RunAgentInput;
  /** The messages new to this run; only these can carry a new answer. */
  persistedInputMessages?: Message[];
  /** The thread's server-side history as Intelligence returned it. */
  historyMessages?: readonly ThreadMessage[];
  userId?: string;
}): HitlResponseEvent[] {
  const { input, userId } = params;
  const identity = userId !== undefined ? { userId } : {};
  const events: HitlResponseEvent[] = [];
  const record = (value: HitlResponseValue): void => {
    if (events.length >= MAX_HITL_RESPONSES_PER_RUN) return;
    events.push({
      type: EventType.CUSTOM,
      name: HITL_RESPONSE_EVENT_NAME,
      value,
    });
  };

  // Tool calls the agent made, and those already answered, per the server.
  const serverCalls = new Map<string, string>();
  const answeredCalls = new Set<string>();
  for (const message of params.historyMessages ?? []) {
    if (message.role === "tool" && typeof message.toolCallId === "string") {
      answeredCalls.add(message.toolCallId);
    }
    if (message.role !== "assistant") continue;
    for (const call of message.toolCalls ?? []) {
      if (typeof call.id === "string" && typeof call.name === "string") {
        serverCalls.set(call.id, call.name);
      }
    }
  }
  const openCallName = (toolCallId: string): string | undefined =>
    answeredCalls.has(toolCallId) ? undefined : serverCalls.get(toolCallId);
  const recordedCalls = new Set<string>();

  const recordedInterrupts = new Set<string>();
  for (const resume of input.resume ?? []) {
    const outcome = resumeOutcome(resume);
    if (outcome === undefined) continue;
    const { interruptId } = resume;
    if (
      typeof interruptId !== "string" ||
      interruptId.length === 0 ||
      interruptId.length > MAX_INTERRUPT_ID_LENGTH ||
      recordedInterrupts.has(interruptId)
    ) {
      continue;
    }
    recordedInterrupts.add(interruptId);
    const toolCallId = resumeToolCallId(resume);
    if (toolCallId !== undefined && answeredCalls.has(toolCallId)) {
      // History already holds this call's answer: an earlier run recorded it.
      continue;
    }
    const toolName =
      toolCallId !== undefined && !recordedCalls.has(toolCallId)
        ? openCallName(toolCallId)
        : undefined;
    if (toolCallId !== undefined && toolName !== undefined) {
      recordedCalls.add(toolCallId);
      record({
        interruptId,
        toolCallId,
        toolName,
        ...identity,
        outcome,
        verified: true,
      });
    } else {
      record({ interruptId, ...identity, outcome, verified: false });
    }
  }

  const hitlToolNames = new Set(
    (input.tools ?? []).filter(isHitlTool).map((tool) => tool.name),
  );
  if (hitlToolNames.size > 0) {
    for (const message of params.persistedInputMessages ?? []) {
      if (message.role !== "tool") continue;
      const { toolCallId } = message;
      if (recordedCalls.has(toolCallId)) continue;
      const toolName = openCallName(toolCallId);
      if (toolName === undefined || !hitlToolNames.has(toolName)) continue;
      recordedCalls.add(toolCallId);
      record({
        toolCallId,
        toolName,
        ...identity,
        outcome: "responded",
        verified: true,
      });
    }
  }

  return events;
}
