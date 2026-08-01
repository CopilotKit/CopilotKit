import { AbstractAgent, EventType, transformChunks } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { firstValueFrom, of, toArray } from "rxjs";
import type { Observable } from "rxjs";
import { describe, expect, it } from "vitest";
import { CopilotKitCore } from "../core";

class RawEventAgent extends AbstractAgent {
  readonly inputs: RunAgentInput[] = [];

  constructor(
    private readonly eventFactory: (input: RunAgentInput) => BaseEvent[],
    agentId = "raw-event-agent",
    threadId = "raw-event-thread",
  ) {
    super({ agentId, threadId });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.inputs.push(input);
    return of(...this.eventFactory(input));
  }
}

function runEvents(input: RunAgentInput): BaseEvent[] {
  return [
    {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    },
    {
      type: EventType.MESSAGES_SNAPSHOT,
      rawEvent: { source: "snapshot" },
      messages: [{ id: "snapshot-user", role: "user", content: "hello" }],
    },
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "assistant-raw-event",
      role: "assistant",
      rawEvent: { langfuse_trace_id: "trace-3039" },
    },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "assistant-raw-event",
      delta: "answer",
    },
    {
      type: EventType.TEXT_MESSAGE_END,
      messageId: "assistant-raw-event",
    },
    {
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
    },
  ];
}

describe("StateManager direct text-start raw event sidecar", () => {
  it("captures scoped metadata without changing canonical or outbound messages", async () => {
    const agent = new RawEventAgent(runEvents);
    const otherAgent = new RawEventAgent(
      (input) => runEvents(input),
      "other-agent",
      "other-thread",
    );
    const core = new CopilotKitCore({
      agents__unsafe_dev_only: {
        [agent.agentId!]: agent,
        [otherAgent.agentId!]: otherAgent,
      },
    });
    let messageChanges = 0;
    agent.subscribe({
      onMessagesChanged: () => {
        messageChanges++;
      },
    });

    await agent.runAgent({ runId: "raw-event-run" });

    expect(messageChanges).toBe(3);

    expect(
      core.getRawEventForMessage(
        "raw-event-agent",
        "raw-event-thread",
        "assistant-raw-event",
      ),
    ).toEqual({ langfuse_trace_id: "trace-3039" });
    expect(
      core.getRawEventForMessage(
        "raw-event-agent",
        "other-thread",
        "assistant-raw-event",
      ),
    ).toBeUndefined();
    expect(
      core.getRawEventForMessage(
        "other-agent",
        "other-thread",
        "assistant-raw-event",
      ),
    ).toBeUndefined();

    for (const message of agent.messages) {
      expect(Object.prototype.hasOwnProperty.call(message, "rawEvent")).toBe(
        false,
      );
    }

    await agent.runAgent({ runId: "raw-event-run-2" });
    for (const message of agent.inputs[1]?.messages ?? []) {
      expect(Object.prototype.hasOwnProperty.call(message, "rawEvent")).toBe(
        false,
      );
    }
  });

  it("preserves false, 0, empty string, and null while ignoring undefined", async () => {
    const values: unknown[] = [false, 0, "", null, undefined];
    const agent = new RawEventAgent((input) => [
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      ...values.flatMap((rawEvent, index) => [
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: `boundary-${index}`,
          role: "assistant",
          ...(rawEvent === undefined ? {} : { rawEvent }),
        } as BaseEvent,
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: `boundary-${index}`,
        } as BaseEvent,
      ]),
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    ]);
    const core = new CopilotKitCore({
      agents__unsafe_dev_only: { [agent.agentId!]: agent },
    });

    await agent.runAgent({ runId: "boundary-run" });

    expect(
      [0, 1, 2, 3].map((index) =>
        core.getRawEventForMessage(
          agent.agentId!,
          agent.threadId,
          `boundary-${index}`,
        ),
      ),
    ).toEqual([false, 0, "", null]);
    expect(
      core.getRawEventForMessage(agent.agentId!, agent.threadId, "boundary-4"),
    ).toBeUndefined();
  });

  it("prunes removed messages and leaves snapshot metadata outside the sidecar", async () => {
    const agent = new RawEventAgent((input) => [
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.MESSAGES_SNAPSHOT,
        rawEvent: { source: "snapshot" },
        messages: [{ id: "snapshot-only", role: "user", content: "old" }],
      },
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "pruned-message",
        role: "assistant",
        rawEvent: { source: "direct" },
      },
      {
        type: EventType.TEXT_MESSAGE_END,
        messageId: "pruned-message",
      },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    ]);
    const core = new CopilotKitCore({
      agents__unsafe_dev_only: { [agent.agentId!]: agent },
    });

    await agent.runAgent({ runId: "prune-run" });
    expect(
      core.getRawEventForMessage(
        agent.agentId!,
        agent.threadId,
        "pruned-message",
      ),
    ).toEqual({ source: "direct" });

    agent.setMessages([]);
    await Promise.resolve();
    expect(
      core.getRawEventForMessage(
        agent.agentId!,
        agent.threadId,
        "pruned-message",
      ),
    ).toBeUndefined();
    expect(
      core.getRawEventForMessage(
        agent.agentId!,
        agent.threadId,
        "snapshot-only",
      ),
    ).toBeUndefined();
  });

  it("leaves TEXT_MESSAGE_CHUNK rawEvent outside the normalized start event", async () => {
    const normalized = await firstValueFrom(
      transformChunks()(
        of({
          type: EventType.TEXT_MESSAGE_CHUNK,
          messageId: "chunk-message",
          delta: "chunk",
          rawEvent: { source: "chunk" },
        }),
      ).pipe(toArray()),
    );

    expect(
      normalized.some((event) => event.type === EventType.TEXT_MESSAGE_CHUNK),
    ).toBe(false);
    expect(
      normalized.find((event) => event.type === EventType.TEXT_MESSAGE_START),
    ).toMatchObject({ messageId: "chunk-message" });
    expect(
      normalized.find((event) => event.type === EventType.TEXT_MESSAGE_START),
    ).not.toHaveProperty("rawEvent");
  });
});
