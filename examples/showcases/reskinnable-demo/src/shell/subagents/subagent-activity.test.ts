import { describe, expect, it } from "vitest";
import {
  derive,
  emptyAccum,
  foldEvent,
  subagentLineageDepth,
} from "./subagent-activity";

describe("subagent activity hierarchy", () => {
  it("projects nested subagent work one level deeper per delegation edge", () => {
    const acc = emptyAccum();

    const events = [
      {
        type: "SUBAGENT_STARTED",
        subagentRunId: "analyst",
        name: "analyst",
      },
      {
        type: "SUBAGENT_STARTED",
        subagentRunId: "researcher",
        parentSubagentRunId: "analyst",
        name: "researcher",
      },
      {
        type: "TEXT_MESSAGE_START",
        subagentRunId: "researcher",
        messageId: "m1",
      },
      {
        type: "TEXT_MESSAGE_CONTENT",
        subagentRunId: "researcher",
        messageId: "m1",
        delta: "checking merchant",
      },
      {
        type: "TOOL_CALL_START",
        subagentRunId: "researcher",
        toolCallId: "t1",
        toolCallName: "search_merchant",
      },
      {
        type: "TOOL_CALL_RESULT",
        subagentRunId: "researcher",
        toolCallId: "t1",
        content: "found",
      },
    ];

    for (const event of events) foldEvent(acc, event);

    const lines = derive(acc).lines;
    expect(lines.find((line) => line.key === "analyst-started")?.depth).toBe(0);
    expect(lines.find((line) => line.key === "researcher-started")?.depth).toBe(1);
    expect(lines.find((line) => line.key === "m1-text")?.depth).toBe(2);
    expect(lines.find((line) => line.key === "t1-cmd")?.depth).toBe(2);
    expect(lines.find((line) => line.key === "t1-out")?.depth).toBe(3);
  });

  it("repairs earlier lines when parent lineage becomes known later", () => {
    const acc = emptyAccum();

    foldEvent(acc, {
      type: "TEXT_MESSAGE_START",
      subagentRunId: "researcher",
      messageId: "m1",
    });
    foldEvent(acc, {
      type: "TEXT_MESSAGE_CONTENT",
      subagentRunId: "researcher",
      messageId: "m1",
      delta: "early output",
    });

    expect(derive(acc).lines.find((line) => line.key === "m1-text")?.depth).toBe(1);

    foldEvent(acc, {
      type: "SUBAGENT_STARTED",
      subagentRunId: "analyst",
      name: "analyst",
    });
    foldEvent(acc, {
      type: "SUBAGENT_STARTED",
      subagentRunId: "researcher",
      parentSubagentRunId: "analyst",
      name: "researcher",
    });

    expect(derive(acc).lines.find((line) => line.key === "m1-text")?.depth).toBe(2);
  });

  it("does not loop forever on malformed cyclic lineage", () => {
    const acc = emptyAccum();
    acc.subagents.set("a", {
      subagentRunId: "a",
      name: "a",
      status: "running",
      parentSubagentRunId: "b",
    });
    acc.subagents.set("b", {
      subagentRunId: "b",
      name: "b",
      status: "running",
      parentSubagentRunId: "a",
    });

    expect(subagentLineageDepth(acc.subagents, "a")).toBe(1);
    expect(subagentLineageDepth(acc.subagents, "b")).toBe(1);
  });
});
