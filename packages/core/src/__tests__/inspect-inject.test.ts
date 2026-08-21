import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { EMPTY } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CopilotKitCore } from "../core";
import {
  ɵinjectInspectorEvents,
  ɵresetInspectorInject,
} from "../core/inspect-inject";

class ReplayAgent extends AbstractAgent {
  run(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }
}

const TEXT_EVENTS: BaseEvent[] = [
  {
    type: EventType.RUN_STARTED,
    threadId: "thread-1",
    runId: "run-1",
  },
  {
    type: EventType.TEXT_MESSAGE_START,
    messageId: "msg-1",
    role: "assistant",
  },
  {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId: "msg-1",
    delta: "Hello from a snippet",
  },
  {
    type: EventType.TEXT_MESSAGE_END,
    messageId: "msg-1",
  },
  {
    type: EventType.RUN_FINISHED,
    threadId: "thread-1",
    runId: "run-1",
  },
];

const TOOL_EVENTS: BaseEvent[] = [
  {
    type: EventType.RUN_STARTED,
    threadId: "thread-1",
    runId: "run-tool",
  },
  {
    type: EventType.TOOL_CALL_START,
    toolCallId: "call-1",
    toolCallName: "sayHello",
    parentMessageId: "asst-1",
  },
  {
    type: EventType.TOOL_CALL_ARGS,
    toolCallId: "call-1",
    delta: '{"name":"Alem"}',
  },
  {
    type: EventType.TOOL_CALL_END,
    toolCallId: "call-1",
  },
  {
    type: EventType.RUN_FINISHED,
    threadId: "thread-1",
    runId: "run-tool",
  },
];

const ACTIVITY_EVENTS: BaseEvent[] = [
  {
    type: EventType.RUN_STARTED,
    threadId: "thread-1",
    runId: "run-ui",
  },
  {
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: "act-ui",
    activityType: "open-generative-ui",
    content: {
      html: ["<div>Hello sandbox</div>"],
      htmlComplete: true,
      generating: false,
    },
    replace: true,
  },
  {
    type: EventType.RUN_FINISHED,
    threadId: "thread-1",
    runId: "run-ui",
  },
];

function createInjectHarness() {
  const agent = new ReplayAgent({ threadId: "thread-1" });
  agent.agentId = "default";
  const core = new CopilotKitCore({
    agents__unsafe_dev_only: { default: agent },
  });
  return { agent, core };
}

describe("ɵinjectInspectorEvents", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies snippet events through runAgent and records new message ids", async () => {
    const { agent, core } = createInjectHarness();

    const result = await ɵinjectInspectorEvents({
      core,
      agent,
      events: TEXT_EVENTS,
    });

    expect(result.messageIds.length).toBeGreaterThan(0);
    const assistant = agent.messages.find((message) =>
      result.messageIds.includes(message.id),
    );
    expect(assistant?.content).toContain("Hello from a snippet");
    expect(assistant?.id).not.toBe("msg-1");
  });

  it("adds a new turn when the same snippet is injected again", async () => {
    const { agent, core } = createInjectHarness();

    const first = await ɵinjectInspectorEvents({
      core,
      agent,
      events: TEXT_EVENTS,
    });
    const second = await ɵinjectInspectorEvents({
      core,
      agent,
      events: TEXT_EVENTS,
    });

    expect(second.messageIds.length).toBeGreaterThan(0);
    expect(second.messageIds[0]).not.toBe(first.messageIds[0]);
    const hellos = agent.messages.filter(
      (message) =>
        message.role === "assistant" &&
        String(message.content).includes("Hello from a snippet"),
    );
    expect(hellos).toHaveLength(2);
  });

  it("adds a new tool call when the same tool snippet is injected again", async () => {
    const { agent, core } = createInjectHarness();

    await ɵinjectInspectorEvents({
      core,
      agent,
      events: TOOL_EVENTS,
    });
    await ɵinjectInspectorEvents({
      core,
      agent,
      events: TOOL_EVENTS,
    });

    const assistants = agent.messages.filter(
      (message) =>
        message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0,
    );
    expect(assistants).toHaveLength(2);
    const firstCall = assistants[0]?.toolCalls?.[0];
    const secondCall = assistants[1]?.toolCalls?.[0];
    expect(firstCall?.function.name).toBe("sayHello");
    expect(secondCall?.function.name).toBe("sayHello");
    expect(firstCall?.id).not.toBe(secondCall?.id);
  });

  it("restores agent.run after inject", async () => {
    const { agent, core } = createInjectHarness();
    const originalRun = agent.run;

    await ɵinjectInspectorEvents({
      core,
      agent,
      events: TEXT_EVENTS,
    });

    expect(agent.run).toBe(originalRun);
  });

  it("does not inject while the agent is running", async () => {
    const { agent, core } = createInjectHarness();
    agent.isRunning = true;

    await expect(
      ɵinjectInspectorEvents({
        core,
        agent,
        events: TEXT_EVENTS,
      }),
    ).rejects.toThrow("The agent is running");
    expect(agent.messages).toEqual([]);
  });

  it("resets only the injected messages", async () => {
    const { agent, core } = createInjectHarness();
    agent.setMessages([{ id: "keep", role: "user", content: "stay" }]);

    const result = await ɵinjectInspectorEvents({
      core,
      agent,
      events: TEXT_EVENTS,
    });
    ɵresetInspectorInject({ agent, messageIds: result.messageIds });

    expect(agent.messages.map((message) => message.id)).toEqual(["keep"]);
  });

  it("applies an open-generative-ui activity snapshot as an activity message", async () => {
    const { agent, core } = createInjectHarness();

    const result = await ɵinjectInspectorEvents({
      core,
      agent,
      events: ACTIVITY_EVENTS,
    });

    expect(result.messageIds.length).toBeGreaterThan(0);
    const activity = agent.messages.find((message) =>
      result.messageIds.includes(message.id),
    );
    expect(activity?.role).toBe("activity");
    expect(activity?.id).not.toBe("act-ui");
  });
});
