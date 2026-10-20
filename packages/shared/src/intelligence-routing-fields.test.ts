import type { BaseEvent } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { describe, expect, it } from "vitest";
import { stripIntelligenceRoutingFields } from "./intelligence-routing-fields";

const stamped = {
  threadId: "t1",
  runId: "r1",
  thread_id: "t1",
  run_id: "r1",
  metadata: { cpki_event_id: "e1" },
};

describe("stripIntelligenceRoutingFields", () => {
  it("removes all routing fields from an event that does not declare them", () => {
    const event = {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "m1",
      delta: "hi",
      ...stamped,
    } as BaseEvent;

    expect(stripIntelligenceRoutingFields(event)).toEqual({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "m1",
      delta: "hi",
      metadata: { cpki_event_id: "e1" },
    });
  });

  it("keeps threadId and runId on the run events that declare them", () => {
    const event = { type: EventType.RUN_FINISHED, ...stamped } as BaseEvent;

    expect(stripIntelligenceRoutingFields(event)).toEqual({
      type: EventType.RUN_FINISHED,
      threadId: "t1",
      runId: "r1",
      metadata: { cpki_event_id: "e1" },
    });
  });

  it("returns an event without routing fields unchanged", () => {
    const event = {
      type: EventType.RUN_STARTED,
      threadId: "t1",
      runId: "r1",
    } as BaseEvent;

    expect(stripIntelligenceRoutingFields(event)).toBe(event);
  });
});
