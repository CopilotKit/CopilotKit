import { describe, expect, it } from "vitest";
import {
  HUMAN_IN_THE_LOOP_ABORTED_MESSAGE,
  withAbortedState,
} from "./human-in-the-loop-abort";

const ABORTED_RESULT = `Error: ${HUMAN_IN_THE_LOOP_ABORTED_MESSAGE}`;

describe("withAbortedState", () => {
  it("marks a complete call whose error is the abort message as aborted", () => {
    const toolCall = withAbortedState({
      status: "complete" as const,
      args: { topic: "launch" },
      result: ABORTED_RESULT,
      error: HUMAN_IN_THE_LOOP_ABORTED_MESSAGE,
    });

    expect(toolCall).toEqual({
      status: "complete",
      args: { topic: "launch" },
      result: undefined,
      aborted: true,
      error: HUMAN_IN_THE_LOOP_ABORTED_MESSAGE,
    });
  });

  it("recognises a restored abort whose error lost its text", () => {
    // `@ag-ui/langgraph` restores a checkpointed tool error as a bare marker,
    // so only the `Error: <message>` content still says why the call failed.
    const toolCall = withAbortedState({
      status: "complete" as const,
      result: ABORTED_RESULT,
      error: "error",
    });

    expect(toolCall).toMatchObject({
      result: undefined,
      aborted: true,
      error: HUMAN_IN_THE_LOOP_ABORTED_MESSAGE,
    });
  });

  it("keeps an answer that reads like the abort text but carries no error", () => {
    const answer = {
      status: "complete" as const,
      result: ABORTED_RESULT,
      error: undefined,
    };

    const toolCall = withAbortedState(answer);

    expect(toolCall).toBe(answer);
    expect(toolCall).not.toHaveProperty("aborted");
  });

  it("keeps a failure for another reason as a failure", () => {
    const failure = {
      status: "complete" as const,
      result: "Error: Network down",
      error: "Network down",
    };

    expect(withAbortedState(failure)).toBe(failure);
  });

  it.each(["in-progress", "executing"] as const)(
    "leaves a %s call untouched",
    (status) => {
      const toolCall = {
        status,
        result: ABORTED_RESULT,
        error: HUMAN_IN_THE_LOOP_ABORTED_MESSAGE,
      };

      expect(withAbortedState(toolCall)).toBe(toolCall);
    },
  );
});
