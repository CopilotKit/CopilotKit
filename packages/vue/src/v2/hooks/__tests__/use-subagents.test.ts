import { defineComponent, ref } from "vue";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/vue";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import type { Subagent } from "@copilotkit/core";
import { afterEach, describe, expect, it } from "vitest";

import { useSubagents } from "../use-subagents";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
} from "../../__tests__/utils/test-helpers";

afterEach(() => cleanup());

function subagentStarted(subagentRunId: string): BaseEvent {
  return {
    type: EventType.SUBAGENT_STARTED,
    subagentRunId,
    name: `${subagentRunId}-agent`,
  } as BaseEvent;
}

function subagentFinished(subagentRunId: string): BaseEvent {
  return { type: EventType.SUBAGENT_FINISHED, subagentRunId } as BaseEvent;
}

const seen: (readonly Subagent[])[] = [];

function probe(threadId?: string) {
  return defineComponent({
    setup() {
      const subagents = useSubagents({ threadId });
      const count = ref(0);
      const record = () => {
        seen.push(subagents.value);
        return "";
      };
      return { subagents, count, record };
    },
    template: `
      <div>
        {{ record() }}
        <button @click="count++">rerender {{ count }}</button>
        <ul data-testid="subagents">
          <li v-for="subagent in subagents" :key="subagent.subagentRunId">{{ subagent.subagentRunId }}:{{ subagent.status }}</li>
        </ul>
      </div>
    `,
  });
}

function setup(threadId?: string) {
  seen.length = 0;
  const agent = new MockStepwiseAgent();
  agent.threadId = "thread-1";
  renderWithCopilotKit({
    agent,
    threadId: "thread-1",
    children: probe(threadId),
  });
  const run = async () => {
    void agent.runAgent({ runId: "run-1" });
    await agent.emit(runStartedEvent({ threadId: "thread-1", runId: "run-1" }));
  };
  return { agent, run };
}

function items() {
  return Array.from(
    screen.getByTestId("subagents").querySelectorAll("li"),
    (item) => item.textContent,
  );
}

describe("useSubagents", () => {
  it("follows the chat thread's subagents as they start and finish", async () => {
    const { agent, run } = setup();
    expect(items()).toEqual([]);

    await run();
    await agent.emit(subagentStarted("research"));
    await agent.emit(subagentStarted("write"));
    await waitFor(() =>
      expect(items()).toEqual(["research:running", "write:running"]),
    );

    await agent.emit(subagentFinished("research"));
    await agent.emit(subagentFinished("write"));
    await agent.emit(
      runFinishedEvent({ threadId: "thread-1", runId: "run-1" }),
    );
    await waitFor(() =>
      expect(items()).toEqual(["research:done", "write:done"]),
    );
  });

  it("reads another thread when one is passed, and ignores this thread's changes", async () => {
    const { agent, run } = setup("other-thread");
    await run();

    await agent.emit(subagentStarted("research"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(items()).toEqual([]);
  });

  it("keeps the same array between renders when nothing changed", async () => {
    setup();
    const first = seen.at(-1);

    await fireEvent.click(screen.getByRole("button"));

    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(first);
  });
});
