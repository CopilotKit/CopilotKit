import { describe, expect, it } from "vitest";
import { firstUserMessage, titleFromText } from "./thread-titles";

describe("thread titles", () => {
  it("keeps a short message whole and cuts a long one at a word", () => {
    expect(titleFromText("  Approve   Priya's offsite report ")).toBe(
      "Approve Priya's offsite report",
    );
    expect(
      titleFromText(
        "Approve Priya Raman's Q3 team offsite expense report and reimburse her.",
      ),
    ).toBe("Approve Priya Raman's Q3 team offsite…");
  });

  it("reads the first user message from the thread's events", () => {
    const events = [
      {
        type: "RUN_STARTED",
        input: { messages: [{ role: "system", content: "x" }] },
      },
      {
        type: "RUN_STARTED",
        input: {
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "What's waiting on me?" }],
            },
          ],
        },
      },
    ];
    expect(firstUserMessage(events)).toBe("What's waiting on me?");
    expect(firstUserMessage([{ type: "RUN_FINISHED" }])).toBeNull();
  });
});
