import { describe, expect, it } from "vitest";

import { parseInterruptPayload } from "./interrupt-payload";

describe("parseInterruptPayload", () => {
  it("parses JSON-stringified legacy payloads", () => {
    expect(
      parseInterruptPayload(
        JSON.stringify({
          topic: "Sales intro",
          attendee: "Sales",
          slots: [{ iso: "2026-07-22T09:00:00Z", label: "Tomorrow at 9" }],
        }),
      ),
    ).toEqual({
      topic: "Sales intro",
      attendee: "Sales",
      slots: [{ iso: "2026-07-22T09:00:00Z", label: "Tomorrow at 9" }],
    });
  });

  it("uses standard interrupt messages and deterministic fallback slots", () => {
    const result = parseInterruptPayload({
      id: "interrupt-1",
      reason: "approval",
      message: "Approve the planning call?",
    });

    expect(result.topic).toBe("Approve the planning call?");
    expect(result.slots).toHaveLength(3);
  });

  it("does not throw for malformed legacy JSON", () => {
    expect(parseInterruptPayload("{bad json").topic).toBe("Meeting");
  });
});
