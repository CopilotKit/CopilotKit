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

function startAndFinish(
  input: RunAgentInput,
  messageId: string,
  rawEvent?: unknown,
): BaseEvent[] {
  return [
    {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    },
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
      ...(rawEvent === undefined ? {} : { rawEvent }),
    } as BaseEvent,
    {
      type: EventType.TEXT_MESSAGE_END,
      messageId,
    },
    {
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
    },
  ];
}

function tenDeltaEvents(input: RunAgentInput, rawEvent?: unknown): BaseEvent[] {
  const messageId = "ten-delta-message";
  return [
    {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    },
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
      ...(rawEvent === undefined ? {} : { rawEvent }),
    } as BaseEvent,
    ...Array.from(
      { length: 10 },
      (_, index) =>
        ({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: `delta-${index}`,
        }) as BaseEvent,
    ),
    {
      type: EventType.TEXT_MESSAGE_END,
      messageId,
    },
    {
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
    },
  ];
}

describe("StateManager direct text-start raw event sidecar", () => {
  it("does not subscribe constructor agents until the registry publishes them", async () => {
    const agent = new RawEventAgent((input) =>
      startAndFinish(input, "constructor-message", { source: "direct" }),
    );
    const core = new CopilotKitCore({
      agents__unsafe_dev_only: { [agent.agentId!]: agent },
    });

    await agent.runAgent({ runId: "constructor-run" });
    expect(
      core.getRawEventForMessage(
        agent.agentId!,
        agent.threadId,
        "constructor-message",
      ),
    ).toBeUndefined();

    core.setAgents__unsafe_dev_only({ [agent.agentId!]: agent });
    await agent.runAgent({ runId: "published-run" });
    expect(
      core.getRawEventForMessage(
        agent.agentId!,
        agent.threadId,
        "constructor-message",
      ),
    ).toEqual({ source: "direct" });
  });

  it("captures replacements and preserves state and message mappings on unsubscribe", async () => {
    let rawEvent = { version: 1 };
    const agent = new RawEventAgent((input) => {
      const events = startAndFinish(input, "replace-message", rawEvent);
      return [
        events[0]!,
        {
          type: EventType.STATE_SNAPSHOT,
          snapshot: { phase: "replace" },
        },
        ...events.slice(1),
      ];
    });
    const core = new CopilotKitCore({});
    core.setAgents__unsafe_dev_only({ [agent.agentId!]: agent });

    await agent.runAgent({ runId: "replace-run-1" });
    expect(
      core.getRawEventForMessage(
        agent.agentId!,
        agent.threadId,
        "replace-message",
      ),
    ).toEqual({ version: 1 });

    rawEvent = { version: 2 };
    await agent.runAgent({ runId: "replace-run-2" });
    expect(
      core.getRawEventForMessage(
        agent.agentId!,
        agent.threadId,
        "replace-message",
      ),
    ).toEqual({ version: 2 });

    const stateBeforeUnsubscribe = core.getStateByRun(
      agent.agentId!,
      agent.threadId,
      "replace-run-2",
    );
    expect(stateBeforeUnsubscribe).toBeDefined();
    expect(
      core.getRunIdForMessage(
        agent.agentId!,
        agent.threadId,
        "replace-message",
      ),
    ).toBe("replace-run-2");

    core.removeAgent__unsafe_dev_only(agent.agentId!);
    await Promise.resolve();

    expect(
      core.getStateByRun(agent.agentId!, agent.threadId, "replace-run-2"),
    ).toEqual(stateBeforeUnsubscribe);
    expect(
      core.getRunIdForMessage(
        agent.agentId!,
        agent.threadId,
        "replace-message",
      ),
    ).toBe("replace-run-2");
    expect(
      core.getRawEventForMessage(
        agent.agentId!,
        agent.threadId,
        "replace-message",
      ),
    ).toBeUndefined();
  });

  it("keeps raw-event capture out of the ten-delta notification budget", async () => {
    const baseline = new RawEventAgent((input) => tenDeltaEvents(input));
    const withMetadata = new RawEventAgent(
      (input) => tenDeltaEvents(input, { source: "direct" }),
      "metadata-agent",
      "metadata-thread",
    );
    const core = new CopilotKitCore({});
    core.setAgents__unsafe_dev_only({
      [baseline.agentId!]: baseline,
      [withMetadata.agentId!]: withMetadata,
    });
    let baselineChanges = 0;
    let metadataChanges = 0;
    baseline.subscribe({
      onMessagesChanged: () => {
        baselineChanges++;
      },
    });
    withMetadata.subscribe({
      onMessagesChanged: () => {
        metadataChanges++;
      },
    });

    await Promise.all([
      baseline.runAgent({ runId: "baseline-run" }),
      withMetadata.runAgent({ runId: "metadata-run" }),
    ]);

    expect(metadataChanges).toBe(baselineChanges);
    expect(metadataChanges).toBeGreaterThanOrEqual(10);
    expect(
      core.getRawEventForMessage(
        withMetadata.agentId!,
        withMetadata.threadId,
        "ten-delta-message",
      ),
    ).toEqual({ source: "direct" });
  });

  it("isolates equal agent, thread, and message IDs by agent scope", async () => {
    const first = new RawEventAgent(
      (input) => startAndFinish(input, "collision-message", { owner: "first" }),
      "first-agent",
      "shared-thread",
    );
    const second = new RawEventAgent(
      (input) =>
        startAndFinish(input, "collision-message", { owner: "second" }),
      "second-agent",
      "shared-thread",
    );
    const core = new CopilotKitCore({});
    core.setAgents__unsafe_dev_only({
      [first.agentId!]: first,
      [second.agentId!]: second,
    });

    await Promise.all([
      first.runAgent({ runId: "first-run" }),
      second.runAgent({ runId: "second-run" }),
    ]);

    expect(
      core.getRawEventForMessage(
        first.agentId!,
        first.threadId,
        "collision-message",
      ),
    ).toEqual({ owner: "first" });
    expect(
      core.getRawEventForMessage(
        second.agentId!,
        second.threadId,
        "collision-message",
      ),
    ).toEqual({ owner: "second" });
  });

  it("returns isolated callback values for mutable raw-event objects", async () => {
    const agent = new RawEventAgent((input) =>
      startAndFinish(input, "mutable-message", {
        trace: { id: "trace-3039" },
      }),
    );
    const core = new CopilotKitCore({});
    core.setAgents__unsafe_dev_only({ [agent.agentId!]: agent });
    await agent.runAgent({ runId: "mutable-run" });

    const callbackValue = core.getRawEventForMessage(
      agent.agentId!,
      agent.threadId,
      "mutable-message",
    ) as { trace: { id: string } };
    callbackValue.trace.id = "changed-by-callback";

    expect(
      core.getRawEventForMessage(
        agent.agentId!,
        agent.threadId,
        "mutable-message",
      ),
    ).toEqual({ trace: { id: "trace-3039" } });
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
    const core = new CopilotKitCore({});
    core.setAgents__unsafe_dev_only({ [agent.agentId!]: agent });

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
    const core = new CopilotKitCore({});
    core.setAgents__unsafe_dev_only({ [agent.agentId!]: agent });

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
