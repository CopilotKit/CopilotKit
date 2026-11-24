import { describe, expect, it } from "vitest";
import {
  CANCELLED_REASON,
  scheduleMeetingTool,
  translateSchedulingResume,
} from "./scheduling";
import type { MeetingChoice } from "./scheduling";
import { toolOptions } from "./test-support/mock-model";

const SLOT = {
  chosen_time: "2026-11-12T10:00:00Z",
  chosen_label: "Thu 10:00 AM",
};

function resumeWith(payload: unknown, status = "resolved") {
  return {
    threadId: "t-1",
    runId: "r-2",
    messages: [],
    resume: [{ interruptId: "call-1", status, payload }],
  };
}

function translatedEntry(
  input: unknown,
  choices = new Map<string, MeetingChoice>(),
) {
  const out = translateSchedulingResume(input, choices) as {
    resume: Array<{ payload?: unknown; status: string }>;
  };
  return out.resume[0]!;
}

describe("translateSchedulingResume", () => {
  it("approves a picked slot and keeps it for the paused call", () => {
    const choices = new Map<string, MeetingChoice>();
    expect(translatedEntry(resumeWith(SLOT), choices).payload).toEqual({
      approved: true,
    });
    expect(choices.get("call-1")).toEqual(SLOT);
  });

  it("rejects a cancel with a reason that says it was cancelled", () => {
    const choices = new Map<string, MeetingChoice>();
    const entry = translatedEntry(resumeWith({ cancelled: true }), choices);
    expect(entry.payload).toEqual({
      approved: false,
      reason: CANCELLED_REASON,
    });
    expect(CANCELLED_REASON).toContain("cancelled");
    expect(choices.size).toBe(0);
  });

  it("rejects an answer without a time", () => {
    const entry = translatedEntry(resumeWith({}));
    expect(entry.payload).toMatchObject({ approved: false });
  });

  it("leaves answers the adapter already understands alone", () => {
    expect(translatedEntry(resumeWith({ approved: true })).payload).toEqual({
      approved: true,
    });
    expect(translatedEntry(resumeWith(false)).payload).toBe(false);
    const cancelled = translatedEntry(resumeWith(undefined, "cancelled"));
    expect(cancelled).toEqual({
      interruptId: "call-1",
      status: "cancelled",
      payload: undefined,
    });
  });

  it("returns a request without a resume unchanged", () => {
    const input = { threadId: "t-1", runId: "r-1", messages: [] };
    expect(translateSchedulingResume(input, new Map())).toBe(input);
    expect(translateSchedulingResume("not json", new Map())).toBe("not json");
  });
});

describe("scheduleMeetingTool", () => {
  const options = toolOptions("call-1");

  it("reports the slot the picker chose, once", async () => {
    const choices = new Map<string, MeetingChoice>([["call-1", SLOT]]);
    const execute = scheduleMeetingTool(choices).execute!;
    await expect(execute({ topic: "Sales intro" }, options)).resolves.toBe(
      "Meeting scheduled for Thu 10:00 AM: Sales intro",
    );
    expect(choices.size).toBe(0);
  });

  it("does not claim a booking without a picked slot", async () => {
    const execute = scheduleMeetingTool(new Map()).execute!;
    const result = await execute({ topic: "Sales intro" }, options);
    expect(result).toContain("NOT scheduled");
  });
});
