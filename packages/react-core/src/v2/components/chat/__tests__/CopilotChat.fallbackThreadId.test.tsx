import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChat } from "../CopilotChat";

// Regression for the #8192 follow-up.
//
// When no threadId is supplied, CopilotChat mints its fallback thread id
// synchronously on the client (a window-guarded useState), not by swapping a
// placeholder for a UUID in a mount effect. The earlier swap changed
// resolvedThreadId right after mount, which the connection effect read as a
// thread switch and tore down the agent's baseline — agent.setMessages([]),
// agent.setState({}), agent.pendingInterrupts = [] (CopilotChat.tsx ~528-555).
//
// This is the opposite of the "+ New" test in
// CopilotChat.absentThreadConnect.test.tsx: a GENUINE switch to a fresh
// non-explicit thread should clear the baseline, but simply MOUNTING a fresh
// chat over an agent that already has state must not.
describe("CopilotChat fallback threadId preserves initial agent state (#8192)", () => {
  it("does not clear an existing agent's messages, state, or interrupts on mount", async () => {
    const agent = new MockStepwiseAgent();
    // The agent already carries a conversation and state before the chat mounts.
    agent.setMessages([{ id: "m1", role: "assistant", content: "preserved" }]);
    agent.setState({ seeded: true });
    agent.pendingInterrupts = [{ id: "approval-1", reason: "confirmation" }];

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChat welcomeScreen={false} />
      </CopilotKitProvider>,
    );

    // Let mount effects run. With a synchronous fallback id there is no
    // placeholder -> UUID transition, so the connection effect never sees a
    // thread switch and the baseline teardown never fires.
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(agent.messages.map(message => message.content)).toEqual([
      "preserved",
    ]);
    expect(agent.state).toEqual({ seeded: true });
    expect(agent.pendingInterrupts).toEqual([
      { id: "approval-1", reason: "confirmation" },
    ]);
  });
});
