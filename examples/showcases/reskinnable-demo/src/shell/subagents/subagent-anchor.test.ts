import { describe, expect, it } from "vitest";
import { findDelegationAnchorToolCallIds } from "./subagent-anchor";

const task = (id: string) => ({
  id,
  function: { name: "task" },
});

describe("subagent console anchoring", () => {
  it("gives every delegating turn its own anchor, not only the latest", () => {
    const messages = [
      { role: "user", content: "analyze the first batch" },
      { role: "assistant", toolCalls: [task("parent-1")] },
      { role: "assistant", toolCalls: [task("nested-1")] },
      { role: "user", content: "run the analysis again" },
      { role: "assistant", toolCalls: [task("parent-2")] },
      { role: "assistant", toolCalls: [task("nested-2")] },
    ];

    expect(findDelegationAnchorToolCallIds(messages)).toEqual([
      "parent-1",
      "parent-2",
    ]);
  });

  it("does not let a later non-delegating turn erase an earlier console anchor", () => {
    const messages = [
      { role: "user", content: "analyze expenses" },
      { role: "assistant", toolCalls: [task("parent")] },
      { role: "assistant", toolCalls: [task("nested")] },
      { role: "user", content: "thanks" },
      { role: "assistant", content: "you're welcome" },
    ];

    expect(findDelegationAnchorToolCallIds(messages)).toEqual(["parent"]);
  });

  it("uses the first task in a turn so nested delegations do not steal the anchor", () => {
    const messages = [
      { role: "assistant", toolCalls: [task("parent")] },
      { role: "assistant", toolCalls: [task("nested-a")] },
      { role: "assistant", toolCalls: [task("nested-b")] },
    ];

    expect(findDelegationAnchorToolCallIds(messages)).toEqual(["parent"]);
  });
});
