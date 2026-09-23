import { describe, expect, it } from "vitest";
import { findLatestDelegationToolCallId } from "./subagent-activity";

const task = (id: string) => ({
  id,
  function: { name: "task" },
});

describe("subagent console anchoring", () => {
  it("anchors repeated delegated runs beside the latest parent turn", () => {
    const messages = [
      { role: "user", content: "analyze the first batch" },
      { role: "assistant", toolCalls: [task("parent-1")] },
      { role: "assistant", toolCalls: [task("nested-1")] },
      { role: "user", content: "run the analysis again" },
      { role: "assistant", toolCalls: [task("parent-2")] },
      { role: "assistant", toolCalls: [task("nested-2")] },
    ];

    expect(findLatestDelegationToolCallId(messages)).toBe("parent-2");
  });

  it("does not let a later non-delegating turn erase the last console anchor", () => {
    const messages = [
      { role: "user", content: "analyze expenses" },
      { role: "assistant", toolCalls: [task("parent")] },
      { role: "assistant", toolCalls: [task("nested")] },
      { role: "user", content: "thanks" },
      { role: "assistant", content: "you're welcome" },
    ];

    expect(findLatestDelegationToolCallId(messages)).toBe("parent");
  });

  it("uses the first task in a turn so nested delegations do not steal the anchor", () => {
    const messages = [
      { role: "assistant", toolCalls: [task("parent")] },
      { role: "assistant", toolCalls: [task("nested-a")] },
      { role: "assistant", toolCalls: [task("nested-b")] },
    ];

    expect(findLatestDelegationToolCallId(messages)).toBe("parent");
  });
});
