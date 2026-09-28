import React from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Subagent } from "@copilotkit/core";
import { useSubagents } from "../use-subagents";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
  subagentFinishedEvent as subagentFinished,
  subagentStartedEvent as subagentStarted,
} from "../../__tests__/utils/test-helpers";

const renders: (readonly Subagent[])[] = [];

function Probe({ threadId }: { threadId?: string }) {
  const subagents = useSubagents({ threadId });
  renders.push(subagents);
  return (
    <ul data-testid="subagents">
      {subagents.map(({ subagentRunId, status }) => (
        <li key={subagentRunId}>{`${subagentRunId}:${status}`}</li>
      ))}
    </ul>
  );
}

function setup(children: React.ReactNode, threadId = "thread-1") {
  renders.length = 0;
  const agent = new MockStepwiseAgent();
  agent.threadId = threadId;
  const view = renderWithCopilotKit({ agent, threadId, children });
  // The run subscribes to the mock's stream after its async setup, so wait a
  // tick before emitting or the first events are lost.
  const run = async () => {
    await act(async () => {
      void agent.runAgent({ runId: "run-1" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    agent.emit(runStartedEvent({ threadId, runId: "run-1" }));
  };
  return { agent, view, run };
}

function items() {
  return Array.from(
    screen.getByTestId("subagents").querySelectorAll("li"),
    (item) => item.textContent,
  );
}

describe("useSubagents", () => {
  it("follows the chat thread's subagents as they start and finish", async () => {
    const { agent, run } = setup(<Probe />);
    expect(items()).toEqual([]);

    await run();
    agent.emit(subagentStarted("research"));
    agent.emit(subagentStarted("write"));
    await waitFor(() =>
      expect(items()).toEqual(["research:running", "write:running"]),
    );

    agent.emit(subagentFinished("research"));
    agent.emit(subagentFinished("write"));
    agent.emit(runFinishedEvent({ threadId: "thread-1", runId: "run-1" }));
    await waitFor(() =>
      expect(items()).toEqual(["research:done", "write:done"]),
    );
  });

  it("reads another thread when one is passed, and ignores this thread's changes", async () => {
    const { agent, run } = setup(<Probe threadId="other-thread" />);
    await run();
    const rendersBefore = renders.length;

    agent.emit(subagentStarted("research"));
    // Events apply asynchronously; give them time to land before asserting nothing changed.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(items()).toEqual([]);
    expect(renders.length).toBe(rendersBefore);
  });

  it("keeps the same array between renders when nothing changed", () => {
    function Parent() {
      const [count, setCount] = React.useState(0);
      return (
        <>
          <button onClick={() => setCount(count + 1)}>rerender</button>
          <Probe />
        </>
      );
    }
    setup(<Parent />);
    const first = renders.at(-1);

    fireEvent.click(screen.getByText("rerender"));

    expect(renders.length).toBeGreaterThan(1);
    expect(renders.at(-1)).toBe(first);
  });
});
