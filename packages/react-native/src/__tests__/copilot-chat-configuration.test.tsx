/**
 * Hooks inside the headless `<CopilotChat agentId>` must use that chat's agent,
 * as they do inside the web CopilotChat. Runs on a REAL `CopilotKitCoreReact`
 * (via `TestCopilotKit`) and the real react-core hooks: mocking
 * `@copilotkit/react-core/v2/headless` (as the sibling chat tests do) would
 * stub the chat configuration under test.
 */
import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import {
  useAgent,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2/headless";
import { CopilotChat, useCopilotChatContext } from "../CopilotChat";
import { SeededAgent, TestCopilotKit } from "../__mocks__/test-copilotkit";

function renderInChat(chat: React.ReactElement) {
  const agents = { x: new SeededAgent() };
  render(
    <TestCopilotKit messages={[]} agents={agents}>
      {chat}
    </TestCopilotKit>,
  );
  return agents;
}

describe("headless CopilotChat chat configuration", () => {
  it("gives hooks inside <CopilotChat agentId> that agent", () => {
    let seen: AbstractAgent | undefined;
    function Probe() {
      seen = useAgent().agent;
      return null;
    }

    const agents = renderInChat(
      <CopilotChat agentId="x">
        <Probe />
      </CopilotChat>,
    );

    expect(seen).toBe(agents.x);
  });

  it("gives hooks inside <CopilotChat threadId> that thread", () => {
    let seenThreadId: string | undefined;
    function Probe() {
      seenThreadId = useCopilotChatConfiguration()?.threadId;
      return null;
    }

    renderInChat(
      <CopilotChat agentId="x" threadId="thread-1">
        <Probe />
      </CopilotChat>,
    );

    expect(seenThreadId).toBe("thread-1");
  });

  it("gives a <CopilotChat> without agentId the agent of the chat around it", () => {
    let seenByChat: AbstractAgent | undefined;
    let seenByHook: AbstractAgent | undefined;
    function Probe() {
      seenByChat = useCopilotChatContext().agent;
      seenByHook = useAgent().agent;
      return null;
    }

    const agents = renderInChat(
      <CopilotChat agentId="x">
        <CopilotChat>
          <Probe />
        </CopilotChat>
      </CopilotChat>,
    );

    expect(seenByChat).toBe(agents.x);
    expect(seenByHook).toBe(agents.x);
  });
});
