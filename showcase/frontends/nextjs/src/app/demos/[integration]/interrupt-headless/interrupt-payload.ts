// When an agent's `schedule_meeting` tool pauses the run, the agent's AG-UI
// bridge decides where the meeting details go and what answer it takes back.
// Each reader below knows one bridge, and the config of an integration picks
// a reader and an answer by key.
import type { Interrupt } from "@copilotkit/react-core/v2";
import type { TimeSlot } from "../_shared/interrupt-fallback-slots";
import { parseJsonResult } from "../_shared/parse-json-result";

/** The meeting the agent asks the user to book. Any field can be missing. */
export interface SchedulingPayload {
  topic?: string;
  attendee?: string;
  slots?: TimeSlot[];
}

/** What the time picker hands back: the chosen slot, or a cancel. */
export type PickerResult =
  | { chosen_time: string; chosen_label: string }
  | { cancelled: true };

/** The parts of a `useInterrupt` render call that a reader looks at. */
export interface InterruptSource {
  /**
   * The legacy event. Its `value` is the `on_interrupt` custom event's value,
   * or the primary standard interrupt.
   */
  event: { value: unknown };
  /** The primary standard interrupt, or `null` for a legacy custom event. */
  interrupt: Interrupt | null;
}

type Fields = Record<string, unknown>;

// The object at `path` inside `value`, or `null` when there is none. Each
// level can be an object or a JSON string. Reading never throws: the readers
// run while React renders, where a throw takes the whole pane down.
function fieldsAt(value: unknown, path: readonly string[]) {
  let fields = parseJsonResult<Fields>(value);
  for (const key of path) {
    fields = parseJsonResult<Fields>(fields[key]);
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

const PAYLOAD_READERS = {
  // LangGraph `interrupt(value)`: the `on_interrupt` event's value is the
  // meeting itself.
  "event-value": ({ event }) => fieldsAt(event.value, []),
  // CrewAI: the flow output under `metadata.crewai.output`, on the standard
  // interrupt or inside the event value.
  "crewai-output": ({ event, interrupt }) =>
    fieldsAt(interrupt?.metadata, ["crewai", "output"]) ??
    fieldsAt(event.value, ["metadata", "crewai", "output"]) ??
    fieldsAt(event.value, []),
  // Strands: the tool's interrupt `reason`. The Python bridge puts it under
  // `metadata.reason`, and the TypeScript bridge JSON-encodes it into
  // `message`. The event value is the last place to look.
  "strands-reason": ({ event, interrupt }) =>
    fieldsAt(interrupt?.metadata, ["reason"]) ??
    fieldsAt(interrupt?.message, ["reason"]) ??
    fieldsAt(interrupt?.message, []) ??
    fieldsAt(event.value, ["metadata", "reason"]) ??
    fieldsAt(event.value, []),
  // Mastra: the bridge wraps the tool's suspend payload as
  // `{ type: "mastra_suspend", suspendPayload, ... }` in the event value.
  "mastra-suspend": ({ event }) =>
    fieldsAt(event.value, ["suspendPayload"]) ?? fieldsAt(event.value, []),
  // OpenAI Agents SDK: the paused call's arguments under
  // `metadata.tool_input`.
  "tool-input": ({ interrupt }) =>
    fieldsAt(interrupt?.metadata, ["tool_input"]),
} satisfies Record<string, (source: InterruptSource) => Fields | null>;

/** Where a bridge puts the meeting details. */
export type InterruptPayloadKey = keyof typeof PAYLOAD_READERS;

const ANSWERS = {
  // The paused tool gets the picker's result as it is.
  selection: (result: PickerResult) => result,
  // The OpenAI Agents SDK resumes an approval-gated tool: `approved: true`
  // with the chosen slot runs the tool once, and `approved: false` cancels it.
  approval: (result: PickerResult) =>
    "cancelled" in result ? { approved: false } : { approved: true, ...result },
} satisfies Record<string, (result: PickerResult) => unknown>;

/** The answer shape a bridge resumes the paused tool with. */
export type InterruptAnswerKey = keyof typeof ANSWERS;

function isTimeSlot(value: unknown): value is TimeSlot {
  if (typeof value !== "object" || value === null) return false;
  const hasLabel = "label" in value && typeof value.label === "string";
  const hasIso = "iso" in value && typeof value.iso === "string";
  return hasLabel && hasIso;
}

/**
 * Reads the meeting from an interrupt, the way the integration's bridge
 * sends it. A field with the wrong type is dropped, so the picker shows its
 * defaults instead.
 *
 * @param key - The reader, from the config of the integration.
 * @param source - The `event` and `interrupt` that `useInterrupt` renders.
 */
export function readSchedulingPayload(
  key: InterruptPayloadKey,
  source: InterruptSource,
) {
  const fields = PAYLOAD_READERS[key](source) ?? {};
  return {
    topic: typeof fields.topic === "string" ? fields.topic : undefined,
    attendee: typeof fields.attendee === "string" ? fields.attendee : undefined,
    slots: Array.isArray(fields.slots)
      ? fields.slots.filter(isTimeSlot)
      : undefined,
  } satisfies SchedulingPayload;
}

/**
 * Turns the picker's result into the value that resumes the paused tool.
 *
 * @param key - The answer shape, from the config of the integration.
 * @param result - What the user picked.
 */
export function encodeAnswer(key: InterruptAnswerKey, result: PickerResult) {
  return ANSWERS[key](result);
}
