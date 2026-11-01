/**
 * Hooks inside the headless `<CopilotChat agentId>` must use that chat's agent,
 * as they do inside the web CopilotChat. Runs on a REAL `CopilotKitCoreReact`
 * and the real react-core hooks: mocking `@copilotkit/react-core/v2/headless`
 * (as the sibling chat tests do) would stub the chat configuration under test.
 */
import React, { useMemo } from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AbstractAgent } from "@ag-ui/client";
import {
  CopilotKitContext,
  CopilotKitCoreReact,
  EMPTY_SET,
} from "@copilotkit/react-core/v2/context";
import type { CopilotKitContextValue } from "@copilotkit/react-core/v2/context";
import {
  useAgent,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2/headless";
import { CopilotChat } from "../CopilotChat";

class StubAgent extends AbstractAgent {
  run(): ReturnType<AbstractAgent["run"]> {
    throw new Error("StubAgent.run() is not used in tests");
  }
}

function renderInChat(chat: React.ReactElement) {
  const agents = { default: new StubAgent(), x: new StubAgent() };
  const copilotkit = new CopilotKitCoreReact({
    agents__unsafe_dev_only: agents,
  });

  function Provider({ children }: { children: React.ReactNode }) {
    const value = useMemo<CopilotKitContextValue>(
      () => ({ copilotkit, executingToolCallIds: EMPTY_SET }),
      [],
    );
    return (
      <CopilotKitContext.Provider value={value}>
        {children}
      </CopilotKitContext.Provider>
    );
  }

  render(<Provider>{chat}</Provider>);
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
});
