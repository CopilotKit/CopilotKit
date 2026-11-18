import { describe, expect, it } from "vitest";
import { CursorAgent } from "../../chat/__tests__/session-test-agent";
import { ɵresetAgentThreadBaseline } from "../thread-baseline";

function agentWithHistory() {
  const agent = new CursorAgent({ threadId: "thread-a" });
  agent.setMessages([{ id: "m1", role: "user", content: "hi" }]);
  agent.setState({ count: 1 });
  agent.pendingInterrupts = [{ id: "i1", reason: "approval" }];
  return agent;
}

describe("ɵresetAgentThreadBaseline", () => {
  it("empties messages, state and interrupts, and clears the thread's cursors", () => {
    const agent = agentWithHistory();

    ɵresetAgentThreadBaseline(agent, { cursorThreadId: "thread-a" });

    expect(agent.messages).toEqual([]);
    expect(agent.state).toEqual({});
    expect(agent.pendingInterrupts).toEqual([]);
    expect(agent.clearedReplayCursors).toEqual(["thread-a"]);
    expect(agent.clearedReconnectCursors).toEqual(["thread-a"]);
  });

  it("keeps pending interrupts when asked", () => {
    const agent = agentWithHistory();

    ɵresetAgentThreadBaseline(agent, { clearPendingInterrupts: false });

    expect(agent.messages).toEqual([]);
    expect(agent.pendingInterrupts).toEqual([{ id: "i1", reason: "approval" }]);
    expect(agent.clearedReplayCursors).toEqual([]);
  });
});
