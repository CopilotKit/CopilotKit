import { describe, expect, it } from "vitest";
import type { Interrupt } from "@copilotkit/react-core/v2";
import { encodeAnswer, readSchedulingPayload } from "./interrupt-payload";
import type { InterruptPayloadKey, InterruptSource } from "./interrupt-payload";

// interrupt-headless keeps a byte-identical copy of interrupt-payload.ts, so
// these tests cover both demos.

const MEETING = { topic: "Sales intro call", attendee: "Sales team" };

// A standard AG-UI interrupt. `useInterrupt` also passes it as the legacy
// event's value.
function fromInterrupt(fields: Partial<Interrupt>) {
  const interrupt = { id: "interrupt-1", reason: "tool_call", ...fields };
  return { event: { value: interrupt }, interrupt };
}

// A legacy `on_interrupt` custom event.
function fromEvent(value: unknown) {
  return { event: { value }, interrupt: null };
}

describe("readSchedulingPayload", () => {
  it.each<[string, InterruptPayloadKey, InterruptSource]>([
    [
      "LangGraph: the JSON-encoded event value",
      "event-value",
      fromEvent(JSON.stringify(MEETING)),
    ],
    [
      "CrewAI: metadata.crewai.output",
      "crewai-output",
      fromInterrupt({ metadata: { crewai: { output: MEETING } } }),
    ],
    [
      "Strands Python: metadata.reason",
      "strands-reason",
      fromInterrupt({ metadata: { reason: MEETING } }),
    ],
    [
      "Strands TypeScript: the reason JSON-encoded in message",
      "strands-reason",
      fromInterrupt({ message: JSON.stringify({ reason: MEETING }) }),
    ],
    [
      "Mastra: suspendPayload in the JSON-encoded event value",
      "mastra-suspend",
      fromEvent(
        JSON.stringify({
          type: "mastra_suspend",
          toolName: "schedule_meeting",
          suspendPayload: MEETING,
        }),
      ),
    ],
    [
      "OpenAI Agents SDK: metadata.tool_input",
      "tool-input",
      fromInterrupt({ metadata: { tool_input: MEETING } }),
    ],
  ])("reads %s", (_, key, source) => {
    expect(readSchedulingPayload(key, source)).toEqual({
      topic: "Sales intro call",
      attendee: "Sales team",
    });
  });

  it("keeps the slots the agent sends", () => {
    const slot = { label: "Monday 9:00 AM", iso: "2026-11-23T09:00:00.000Z" };
    const source = fromEvent({ ...MEETING, slots: [slot, { label: 3 }] });

    expect(readSchedulingPayload("event-value", source).slots).toEqual([slot]);
  });

  it("drops a field with the wrong type", () => {
    const source = fromEvent({ topic: "Sales intro call", attendee: {} });

    expect(readSchedulingPayload("event-value", source)).toEqual({
      topic: "Sales intro call",
    });
  });

  it("returns no fields for a value that is not JSON", () => {
    expect(
      readSchedulingPayload("event-value", fromEvent("{not json")),
    ).toEqual({});
  });
});

describe("encodeAnswer", () => {
  const pick = {
    chosen_time: "2026-11-23T09:00:00.000Z",
    chosen_label: "Monday 9:00 AM",
  };

  it("hands a selection to the tool as it is", () => {
    expect(encodeAnswer("selection", pick)).toEqual(pick);
  });

  it("approves a pick and declines a cancel for an approval-gated tool", () => {
    expect(encodeAnswer("approval", pick)).toEqual({
      approved: true,
      chosen_time: "2026-11-23T09:00:00.000Z",
      chosen_label: "Monday 9:00 AM",
    });
    expect(encodeAnswer("approval", { cancelled: true })).toEqual({
      approved: false,
    });
  });
});
