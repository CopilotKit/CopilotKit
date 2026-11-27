import { describe, expect, it } from "vitest";
import { CANCELLED_REASON, scheduleMeetingTool } from "./scheduling";
import type { MeetingChoice } from "./scheduling";
import { toolOptions } from "./test-support/mock-model";

const SLOT = {
  chosen_time: "2026-11-12T10:00:00Z",
  chosen_label: "Thu 10:00 AM",
};

/** The tool's `execute`, on a run whose resume answered `call-1` with `answer`. */
function executeAnswered(answer?: MeetingChoice) {
  const answers = new Map<string, MeetingChoice>();
  if (answer) answers.set("call-1", answer);
  const run = {
    resumePayload: <T>(toolCallId: string) =>
      answers.get(toolCallId) as T | undefined,
  };
  const execute = scheduleMeetingTool(run).execute!;
  return (topic: string) => execute({ topic }, toolOptions("call-1"));
}

describe("scheduleMeetingTool", () => {
  it("reports the slot the picker chose", async () => {
    await expect(executeAnswered(SLOT)("Sales intro")).resolves.toBe(
      "Meeting scheduled for Thu 10:00 AM: Sales intro",
    );
  });

  it("says a cancelled booking was cancelled", async () => {
    const result = await executeAnswered({ cancelled: true })("Sales intro");
    expect(result).toContain(CANCELLED_REASON);
    expect(CANCELLED_REASON).toContain("cancelled");
  });

  it("does not claim a booking without a picked slot", async () => {
    for (const answer of [undefined, {}]) {
      const result = await executeAnswered(answer)("Sales intro");
      expect(result).toContain("NOT scheduled");
      expect(result).not.toContain("cancelled");
    }
  });
});
