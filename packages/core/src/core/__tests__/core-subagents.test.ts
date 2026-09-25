import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { NEVER, concat, of } from "rxjs";
import type { Observable } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { CopilotKitCore } from "../core";
import type { Subagent } from "../subagent-state";

type Script = (input: RunAgentInput) => Observable<BaseEvent>;

class ScriptedAgent extends AbstractAgent {
  script: Script = () => of();

  constructor(threadId = "thread-1") {
    super({ agentId: "supervisor", threadId });
  }

  run(input: RunAgentInput) {
    return this.script(input);
  }
}

function runStarted(input: RunAgentInput): BaseEvent {
  return {
    type: EventType.RUN_STARTED,
    threadId: input.threadId,
    runId: input.runId,
  };
}

function runFinished(input: RunAgentInput): BaseEvent {
  return {
    type: EventType.RUN_FINISHED,
    threadId: input.threadId,
    runId: input.runId,
  };
}

function subagentStarted(subagentRunId: string, extra: object = {}): BaseEvent {
  return {
    type: EventType.SUBAGENT_STARTED,
    subagentRunId,
    name: `${subagentRunId}-agent`,
    ...extra,
  } as BaseEvent;
}

function subagentFinished(
  subagentRunId: string,
  extra: object = {},
): BaseEvent {
  return {
    type: EventType.SUBAGENT_FINISHED,
    subagentRunId,
    ...extra,
  } as BaseEvent;
}

/** Run the agent with events wrapped in RUN_STARTED / RUN_FINISHED. */
function script(...events: BaseEvent[]): Script {
  return (input) => of(runStarted(input), ...events, runFinished(input));
}

function setup(threadId?: string) {
  const agent = new ScriptedAgent(threadId);
  const core = new CopilotKitCore({});
  core.setAgents__unsafe_dev_only({ supervisor: agent });
  const notifications: { threadId: string; subagents: readonly Subagent[] }[] =
    [];
  core.subscribe({
    onSubagentsChanged: ({ agentId, threadId, subagents }) => {
      expect(agentId).toBe("supervisor");
      notifications.push({ threadId, subagents });
    },
  });
  const statuses = (thread = agent.threadId) =>
    core
      .getSubagents("supervisor", thread)
      .map(({ subagentRunId, status }) => `${subagentRunId}:${status}`);
  return { agent, core, notifications, statuses };
}

describe("CopilotKitCore subagent tracking", () => {
  it("tracks parallel subagents through a real run and notifies once per change", async () => {
    const { agent, core, notifications, statuses } = setup();
    agent.script = script(
      subagentStarted("research", { parentToolCallId: "call-1" }),
      subagentStarted("write", { parentToolCallId: "call-2" }),
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "research-1",
        role: "assistant",
        subagentRunId: "research",
      } as BaseEvent,
      { type: EventType.TEXT_MESSAGE_END, messageId: "research-1" },
      subagentFinished("write"),
      {
        type: EventType.SUBAGENT_ERROR,
        subagentRunId: "research",
        message: "Search failed",
      } as BaseEvent,
    );

    await agent.runAgent({ runId: "run-1" });

    expect(core.getSubagents("supervisor", "thread-1")).toEqual([
      {
        subagentRunId: "research",
        name: "research-agent",
        parentToolCallId: "call-1",
        status: "error",
        error: { message: "Search failed" },
      },
      {
        subagentRunId: "write",
        name: "write-agent",
        parentToolCallId: "call-2",
        status: "done",
      },
    ]);
    expect(notifications.map(({ subagents }) => subagents.length)).toEqual([
      1, 2, 2, 2,
    ]);
    expect(notifications.at(-1)?.subagents).toBe(
      core.getSubagents("supervisor", "thread-1"),
    );
    expect(statuses()).toEqual(["research:error", "write:done"]);
  });

  it("fails open subagents with the run's message when the run errors", async () => {
    const { agent, core } = setup();
    agent.script = (input) =>
      of(runStarted(input), subagentStarted("research"), {
        type: EventType.RUN_ERROR,
        message: "Agent crashed",
      } as BaseEvent);

    await agent.runAgent({ runId: "run-1" }).catch(() => undefined);

    expect(core.getSubagents("supervisor", "thread-1")).toEqual([
      {
        subagentRunId: "research",
        name: "research-agent",
        status: "error",
        error: { message: "Agent crashed", code: "RUN_ERROR" },
      },
    ]);
  });

  it("cancels a subagent the client aborted before any closer arrived", async () => {
    const { agent, statuses } = setup();
    agent.script = (input) =>
      concat(of(runStarted(input), subagentStarted("research")), NEVER);

    const run = agent.runAgent({ runId: "run-1" }).catch(() => undefined);
    await vi.waitFor(() => expect(statuses()).toEqual(["research:running"]));

    await agent.detachActiveRun();
    await run;

    expect(statuses()).toEqual(["research:error"]);
  });

  it("keeps a suspended subagent across runs and continues it under the same id", async () => {
    const { agent, core, statuses } = setup();
    agent.script = script(
      subagentStarted("approve"),
      subagentFinished("approve", {
        outcome: { type: "suspended", interruptIds: ["interrupt-1"] },
      }),
    );
    await agent.runAgent({ runId: "run-1" });
    expect(core.getSubagents("supervisor", "thread-1")).toEqual([
      {
        subagentRunId: "approve",
        name: "approve-agent",
        status: "suspended",
        interruptIds: ["interrupt-1"],
      },
    ]);

    agent.script = script(
      subagentStarted("approve"),
      subagentFinished("approve"),
    );
    await agent.runAgent({ runId: "run-2" });

    expect(statuses()).toEqual(["approve:done"]);
  });

  it("keeps each thread's subagents apart", async () => {
    const { agent, notifications, statuses } = setup("thread-a");
    agent.script = script(
      subagentStarted("from-a"),
      subagentFinished("from-a"),
    );
    await agent.runAgent({ runId: "run-a" });

    agent.threadId = "thread-b";
    agent.script = script(
      subagentStarted("from-b"),
      subagentFinished("from-b"),
    );
    await agent.runAgent({ runId: "run-b" });

    expect(statuses("thread-a")).toEqual(["from-a:done"]);
    expect(statuses("thread-b")).toEqual(["from-b:done"]);
    expect(notifications.map(({ threadId }) => threadId)).toEqual([
      "thread-a",
      "thread-a",
      "thread-b",
      "thread-b",
    ]);
  });

  it("returns the same empty list for a thread with no subagents", () => {
    const { core } = setup();

    expect(core.getSubagents("supervisor", "unknown")).toEqual([]);
    expect(core.getSubagents("supervisor", "unknown")).toBe(
      core.getSubagents("other", "unknown"),
    );
  });
});
