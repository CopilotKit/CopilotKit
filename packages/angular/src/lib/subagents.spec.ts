import {
  EnvironmentInjector,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { CopilotKitCore } from "@copilotkit/core";
import { of } from "rxjs";
import { beforeEach, describe, expect, it } from "vitest";

import { COPILOT_CHAT_CONFIGURATION } from "./chat-configuration";
import { CopilotKit } from "./copilotkit";
import { injectSubagents } from "./subagents";

class ScriptedAgent extends AbstractAgent {
  events: BaseEvent[] = [];

  run(input: RunAgentInput) {
    return of(
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      ...this.events,
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    );
  }
}

function subagentStarted(subagentRunId: string): BaseEvent {
  return {
    type: EventType.SUBAGENT_STARTED,
    subagentRunId,
    name: `${subagentRunId}-agent`,
  } as BaseEvent;
}

function subagentFinished(
  subagentRunId: string,
  outcome?: { type: "suspended" },
): BaseEvent {
  return {
    type: EventType.SUBAGENT_FINISHED,
    subagentRunId,
    outcome,
  } as BaseEvent;
}

describe("injectSubagents", () => {
  const threadId = signal("thread-1");
  let agent: ScriptedAgent;
  let injector: EnvironmentInjector;

  beforeEach(() => {
    TestBed.resetTestingModule();
    agent = new ScriptedAgent({ agentId: "supervisor", threadId: "thread-1" });
    const core = new CopilotKitCore({});
    core.setAgents__unsafe_dev_only({ supervisor: agent });
    threadId.set("thread-1");
    TestBed.configureTestingModule({
      providers: [
        { provide: CopilotKit, useValue: { core } },
        {
          provide: COPILOT_CHAT_CONFIGURATION,
          useValue: { agentId: signal("supervisor"), threadId },
        },
      ],
    });
    injector = createEnvironmentInjector(
      [],
      TestBed.inject(EnvironmentInjector),
    );
  });

  const statuses = (subagents: ReturnType<typeof injectSubagents>) =>
    subagents().map(
      ({ subagentRunId, status }) => `${subagentRunId}:${status}`,
    );

  it("follows the chat thread's subagents through a run", async () => {
    const subagents = runInInjectionContext(injector, () => injectSubagents());
    expect(statuses(subagents)).toEqual([]);

    agent.events = [
      subagentStarted("research"),
      subagentStarted("approve"),
      subagentFinished("research"),
      subagentFinished("approve", { type: "suspended" }),
    ];
    await agent.runAgent({ runId: "run-1" });

    expect(statuses(subagents)).toEqual(["research:done", "approve:suspended"]);
  });

  it("switches to the new thread when the chat thread changes", async () => {
    const subagents = runInInjectionContext(injector, () => injectSubagents());
    agent.events = [subagentStarted("research"), subagentFinished("research")];
    await agent.runAgent({ runId: "run-1" });

    threadId.set("thread-2");

    expect(statuses(subagents)).toEqual([]);
  });

  it("reads an explicit thread and keeps the same array while it is unchanged", async () => {
    const subagents = runInInjectionContext(injector, () =>
      injectSubagents({ threadId: "other-thread" }),
    );
    const before = subagents();

    agent.events = [subagentStarted("research"), subagentFinished("research")];
    await agent.runAgent({ runId: "run-1" });

    expect(subagents()).toBe(before);
  });

  it("stops updating after its injector is destroyed", async () => {
    const subagents = runInInjectionContext(injector, () => injectSubagents());
    // Read once so the signal caches; only a live subscription can refresh it.
    expect(statuses(subagents)).toEqual([]);
    injector.destroy();

    agent.events = [subagentStarted("research"), subagentFinished("research")];
    await agent.runAgent({ runId: "run-1" });

    expect(statuses(subagents)).toEqual([]);
  });
});
