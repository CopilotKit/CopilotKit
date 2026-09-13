/**
 * The resume envelope is not one shape.
 *
 * The pinned `@ag-ui/aws-strands` 0.2.3 hands a resolved answer straight
 * through (`{ chosen_label, chosen_time }`) and signals a cancel as
 * `{ status: "cancelled" }`. `ag_ui_strands` (Python) wraps the answer as
 * `{ response: ... }` and cancels with `{ cancelled: true }`. A tool that reads
 * only the wrapped shape sees no answer on the TypeScript bridge and tells the
 * model the user never picked a time, which no aimock-backed test can catch:
 * the narration comes from the fixture, not from the tool result.
 */

import { describe, expect, it } from "vitest";
import { readResume } from "./interrupt-agent";

describe("readResume", () => {
  it("reads a payload the published TypeScript bridge passes through raw", () => {
    const { choice, cancelled } = readResume({
      chosen_label: "Tomorrow 10:00 AM",
      chosen_time: "2026-09-05T10:00:00Z",
    });
    expect(cancelled).toBe(false);
    expect(choice.chosen_label).toBe("Tomorrow 10:00 AM");
  });

  it("reads a payload the Python bridge wraps in an envelope", () => {
    const { choice, cancelled } = readResume({
      response: { chosen_label: "Monday 9:00 AM" },
    });
    expect(cancelled).toBe(false);
    expect(choice.chosen_label).toBe("Monday 9:00 AM");
  });

  it("treats each bridge's cancel sentinel as a cancel", () => {
    expect(readResume({ status: "cancelled" }).cancelled).toBe(true);
    expect(readResume({ cancelled: true }).cancelled).toBe(true);
  });

  it("treats the picker's own cancel flag as a cancel in both shapes", () => {
    expect(readResume({ cancelled: true }).cancelled).toBe(true);
    expect(readResume({ response: { cancelled: true } }).cancelled).toBe(true);
  });

  it("reads a cancel sentinel that arrives inside the wrapper", () => {
    expect(readResume({ response: { status: "cancelled" } }).cancelled).toBe(
      true,
    );
  });

  it("falls back to the chosen time when the label is empty", () => {
    const { choice } = readResume({
      response: { chosen_label: "", chosen_time: "2026-09-05T10:00:00Z" },
    });
    expect(choice.chosen_label || choice.chosen_time).toBe(
      "2026-09-05T10:00:00Z",
    );
  });

  it("survives an answer that is not an object at all", () => {
    expect(readResume(null).cancelled).toBe(false);
    expect(readResume(undefined).choice).toEqual({});
    expect(readResume("nope" as unknown as null).choice).toEqual({});
  });

  it("reports no choice when the answer carries none", () => {
    expect(readResume({ response: null }).choice).toEqual({});
  });
});
