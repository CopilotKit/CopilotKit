import { describe, it, expect } from "vitest";
import { ToolCallStatus } from "@copilotkit/core";
import {
  HUMAN_IN_THE_LOOP_ABORTED_MESSAGE,
  withAbortedState,
} from "../human-in-the-loop-abort";

const abortedText = `Error: ${HUMAN_IN_THE_LOOP_ABORTED_MESSAGE}`;

describe("withAbortedState", () => {
  it("flags a Complete call whose error is the abort instead of passing its text as an answer", () => {
    const out = withAbortedState({
      status: ToolCallStatus.Complete,
      result: abortedText,
      error: HUMAN_IN_THE_LOOP_ABORTED_MESSAGE,
    });
    expect(out).toEqual({
      status: ToolCallStatus.Complete,
      result: undefined,
      aborted: true,
      error: HUMAN_IN_THE_LOOP_ABORTED_MESSAGE,
    });
  });

  it("leaves an answer that reads like the abort text untouched", () => {
    const props = { status: ToolCallStatus.Complete, result: abortedText };
    expect(withAbortedState(props)).toBe(props);
  });

  it("leaves a call that failed for another reason untouched", () => {
    const props = {
      status: ToolCallStatus.Complete,
      result: "Error: Invalid arguments",
      error: "Invalid arguments",
    };
    expect(withAbortedState(props)).toBe(props);
  });

  // @ag-ui/langgraph 0.0.44 restores a checkpointed tool error as
  // `error: "error"`: the call is still marked failed, but its message is
  // gone and only the content says it was the abort.
  it("flags an abort restored with its error text reduced to a status", () => {
    const out = withAbortedState({
      status: ToolCallStatus.Complete,
      result: abortedText,
      error: "error",
    });
    expect(out).toEqual({
      status: ToolCallStatus.Complete,
      result: undefined,
      aborted: true,
      error: HUMAN_IN_THE_LOOP_ABORTED_MESSAGE,
    });
  });

  it("leaves a restored failure with other content untouched", () => {
    const props = {
      status: ToolCallStatus.Complete,
      result: "Error: Invalid arguments",
      error: "error",
    };
    expect(withAbortedState(props)).toBe(props);
  });

  it.each([ToolCallStatus.InProgress, ToolCallStatus.Executing])(
    "ignores a %s call even when it carries the abort",
    (status) => {
      const props = {
        status,
        result: abortedText,
        error: HUMAN_IN_THE_LOOP_ABORTED_MESSAGE,
      };
      expect(withAbortedState(props)).toBe(props);
    },
  );

  it("keeps the other render props", () => {
    const respond = undefined;
    const out = withAbortedState({
      name: "approve",
      toolCallId: "tc-1",
      args: { action: "delete" },
      status: ToolCallStatus.Complete,
      result: abortedText,
      error: HUMAN_IN_THE_LOOP_ABORTED_MESSAGE,
      respond,
    });
    expect(out).toMatchObject({
      name: "approve",
      toolCallId: "tc-1",
      args: { action: "delete" },
      respond: undefined,
      aborted: true,
    });
  });
});
