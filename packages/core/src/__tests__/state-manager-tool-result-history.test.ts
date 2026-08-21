import { describe, expect, it } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/client";
import { from, throwError } from "rxjs";
import type { Observable } from "rxjs";
import { CopilotKitCore } from "../core";

const threadId = "thread-tool-history";
const toolCallId = "call-weather";

class ScriptedWeatherAgent extends AbstractAgent {
  readonly inputs: RunAgentInput[] = [];
  secondTurnError?: string;

  constructor(
    private readonly staleSnapshot = true,
    private readonly failSecondTurnBeforeStart = false,
  ) {
    super({
      agentId: "weather",
      threadId,
      initialMessages: [
        { id: "user-1", role: "user", content: "What is the weather?" },
      ],
    });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.inputs.push(input);
    if (this.inputs.length === 2) {
      if (this.failSecondTurnBeforeStart) {
        this.secondTurnError = "401 Unauthorized";
        return throwError(() => new Error(this.secondTurnError));
      }
      if (
        !input.messages.some(
          (message) =>
            message.role === "tool" && message.toolCallId === toolCallId,
        )
      ) {
        this.secondTurnError =
          "400 Bad Request: missing tool result for call-weather";
        return throwError(() => new Error(this.secondTurnError));
      }
      return from([
        { type: EventType.RUN_STARTED, threadId, runId: input.runId },
        { type: EventType.RUN_FINISHED, threadId, runId: input.runId },
      ] as BaseEvent[]);
    }

    const owner: Message = {
      id: "assistant-weather",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: toolCallId,
          type: "function",
          function: { name: "get_weather", arguments: "{}" },
        },
      ],
    };
    const events: BaseEvent[] = [
      { type: EventType.RUN_STARTED, threadId, runId: input.runId },
      {
        type: EventType.TOOL_CALL_START,
        toolCallId,
        toolCallName: "get_weather",
        parentMessageId: owner.id,
      },
      { type: EventType.TOOL_CALL_END, toolCallId },
      {
        type: EventType.TOOL_CALL_RESULT,
        messageId: "result-weather",
        toolCallId,
        content: "72 degrees and sunny",
        role: "tool",
      },
    ];
    if (this.staleSnapshot) {
      events.push({
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [
          { id: "user-1", role: "user", content: "What is the weather?" },
          owner,
        ],
      });
    }
    events.push({ type: EventType.RUN_FINISHED, threadId, runId: input.runId });
    return from(events);
  }
}

class ScenarioAgent extends AbstractAgent {
  readonly inputs: RunAgentInput[] = [];

  constructor(
    agentId: string,
    initialMessages: Message[],
    private readonly events: BaseEvent[],
  ) {
    super({ agentId, threadId: `${agentId}-thread`, initialMessages });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.inputs.push(input);
    return from(
      this.events.map((event) =>
        event.type === EventType.RUN_STARTED ||
        event.type === EventType.RUN_FINISHED
          ? { ...event, runId: input.runId, threadId: this.threadId }
          : event,
      ),
    );
  }
}

class LocalFailureBeforeStartAgent extends AbstractAgent {
  readonly inputs: RunAgentInput[] = [];

  constructor() {
    super({ agentId: "local-failure", threadId: "local-failure-thread" });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.inputs.push(input);
    if (this.inputs.length === 1) {
      return from([
        {
          type: EventType.RUN_STARTED,
          threadId: this.threadId,
          runId: input.runId,
        },
      ] as BaseEvent[]);
    }
    return throwError(() => new Error("local failure before start"));
  }
}

const owner = (id: string, ...callIds: string[]) => ({
  id,
  role: "assistant" as const,
  content: "",
  toolCalls: callIds.map((callId) => ({
    id: callId,
    type: "function" as const,
    function: { name: "tool", arguments: "{}" },
  })),
});

const result = (messageId: string, callId: string, content = "result") => ({
  type: EventType.TOOL_CALL_RESULT as const,
  messageId,
  toolCallId: callId,
  content,
  role: "tool" as const,
});

async function addAgent(
  core: CopilotKitCore,
  agent: AbstractAgent,
): Promise<void> {
  core.addAgent__unsafe_dev_only({ id: agent.agentId!, agent });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("StateManager tool result history", () => {
  it("preserves the result in a real runAgent second turn", async () => {
    const agent = new ScriptedWeatherAgent();
    const core = new CopilotKitCore({});
    await addAgent(core, agent);

    await core.runAgent({ agent });
    await expect(core.runAgent({ agent })).resolves.toBeDefined();

    expect(agent.secondTurnError).toBeUndefined();
    expect(
      agent.inputs[1]?.messages.filter(
        (message) =>
          message.role === "tool" && message.toolCallId === toolCallId,
      ),
    ).toHaveLength(1);
  });

  it("returns a terminal messages mutation through the real apply pipeline", async () => {
    const seen: Message[][] = [];
    const agent = new ScriptedWeatherAgent();
    agent.subscribe({
      onMessagesChanged: ({ messages }) => {
        seen.push([...messages]);
      },
    });
    const core = new CopilotKitCore({});
    await addAgent(core, agent);

    await core.runAgent({ agent });

    expect(seen.at(-1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "result-weather", toolCallId }),
      ]),
    );
  });

  it("keeps one result when LangGraph uses divergent message ids", async () => {
    const callId = "call_weather_1";
    const checkpointId = "lc-tool-1";
    const agent = new ScenarioAgent(
      "langgraph",
      [owner("assistant-weather", callId)],
      [
        { type: EventType.RUN_STARTED, threadId: "x", runId: "x" },
        result("72192d78-8458-4e31-a03f-eddbcc88ed58", callId, "72 and sunny"),
        {
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [
            owner("assistant-weather", callId),
            {
              id: checkpointId,
              role: "tool",
              toolCallId: callId,
              content: "72 and sunny",
            },
            {
              id: "72192d78-8458-4e31-a03f-eddbcc88ed58",
              role: "tool",
              toolCallId: callId,
              content: "72 and sunny",
            },
          ],
        },
        { type: EventType.RUN_FINISHED, threadId: "x", runId: "x" },
      ],
    );
    const core = new CopilotKitCore({});
    await addAgent(core, agent);
    await core.runAgent({ agent });
    await core.runAgent({ agent });

    expect(
      agent.messages.filter(
        (message) => message.role === "tool" && message.toolCallId === callId,
      ),
    ).toEqual([
      expect.objectContaining({
        toolCallId: callId,
        content: "72 and sunny",
      }),
    ]);
    expect(
      agent.inputs[1]?.messages.filter(
        (message) => message.role === "tool" && message.toolCallId === callId,
      ),
    ).toHaveLength(1);
    expect(
      core.getRunIdForMessage("langgraph", "langgraph-thread", checkpointId),
    ).toBe(agent.inputs[0]?.runId);
  });

  it("does not replay a prior result across server runs in one input", async () => {
    const callId = "call-multirun";
    const agent = new ScenarioAgent(
      "multirun",
      [owner("assistant-multirun", callId)],
      [
        { type: EventType.RUN_STARTED, threadId: "x", runId: "x" },
        result("run-one-result", callId, "first run"),
        { type: EventType.RUN_FINISHED, threadId: "x", runId: "x" },
        { type: EventType.RUN_STARTED, threadId: "x", runId: "x" },
        {
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [owner("assistant-multirun", callId)],
        },
        { type: EventType.RUN_FINISHED, threadId: "x", runId: "x" },
      ],
    );
    const core = new CopilotKitCore({});
    await addAgent(core, agent);
    await core.runAgent({ agent });

    expect(
      agent.messages.filter(
        (message) => message.role === "tool" && message.toolCallId === callId,
      ),
    ).toHaveLength(0);
  });

  it("preserves normal result delivery and removes duplicate identities", async () => {
    const callId = "call-duplicate";
    const agent = new ScenarioAgent(
      "duplicate",
      [owner("assistant-duplicate", callId)],
      [
        {
          type: EventType.RUN_STARTED,
          threadId: "duplicate-thread",
          runId: "x",
        },
        result("result-a", callId, "a"),
        result("result-b", callId, "b"),
        {
          type: EventType.RUN_FINISHED,
          threadId: "duplicate-thread",
          runId: "x",
        },
      ],
    );
    const core = new CopilotKitCore({});
    await addAgent(core, agent);
    let delivered = 0;
    agent.subscribe({ onToolCallResultEvent: () => void delivered++ });
    await core.runAgent({ agent });

    expect(
      agent.messages.filter(
        (message) => message.role === "tool" && message.toolCallId === callId,
      ),
    ).toEqual([expect.objectContaining({ id: "result-a", content: "a" })]);
    expect(
      core.getRunIdForMessage("duplicate", "duplicate-thread", "result-a"),
    ).toBe(agent.inputs[0]?.runId);
    expect(delivered).toBe(2);
  });

  it("restores multiple tool results after their assistant owner", async () => {
    const firstCallId = "call-first";
    const secondCallId = "call-second";
    const agent = new ScenarioAgent(
      "siblings",
      [owner("assistant-siblings", firstCallId, secondCallId)],
      [
        {
          type: EventType.RUN_STARTED,
          threadId: "siblings-thread",
          runId: "x",
        },
        result("first-result", firstCallId, "first"),
        result("second-result", secondCallId, "second"),
        {
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [owner("assistant-siblings", firstCallId, secondCallId)],
        },
        {
          type: EventType.RUN_FINISHED,
          threadId: "siblings-thread",
          runId: "x",
        },
      ],
    );
    const core = new CopilotKitCore({});
    await addAgent(core, agent);
    await core.runAgent({ agent });

    expect(
      agent.messages
        .filter((message) => message.role === "tool")
        .map((message) => [message.toolCallId, message.content]),
    ).toEqual([
      [firstCallId, "first"],
      [secondCallId, "second"],
    ]);
  });

  it("replaces an already materialized frontend placeholder", async () => {
    const callId = "call-placeholder";
    const agent = new ScenarioAgent(
      "placeholder",
      [
        owner("assistant-placeholder", callId),
        {
          id: "placeholder-result",
          role: "tool",
          toolCallId: callId,
          content: "Forwarded to client",
        },
      ],
      [
        {
          type: EventType.RUN_STARTED,
          threadId: "placeholder-thread",
          runId: "x",
        },
        result("canonical-result", callId, "canonical"),
        {
          type: EventType.RUN_FINISHED,
          threadId: "placeholder-thread",
          runId: "x",
        },
      ],
    );
    const core = new CopilotKitCore({});
    await addAgent(core, agent);
    await core.runAgent({ agent });

    expect(
      agent.messages.filter(
        (message) => message.role === "tool" && message.toolCallId === callId,
      ),
    ).toEqual([
      expect.objectContaining({ id: "canonical-result", content: "canonical" }),
    ]);
    expect(
      core.getRunIdForMessage(
        "placeholder",
        "placeholder-thread",
        "canonical-result",
      ),
    ).toBe(agent.inputs[0]?.runId);
  });

  it("promotes a placeholder retained by a later snapshot", async () => {
    const callId = "call-snapshot-placeholder";
    const agent = new ScenarioAgent(
      "snapshot-placeholder",
      [owner("assistant-snapshot-placeholder", callId)],
      [
        {
          type: EventType.RUN_STARTED,
          threadId: "snapshot-placeholder-thread",
          runId: "x",
        },
        result("snapshot-canonical", callId, "canonical"),
        {
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [
            owner("assistant-snapshot-placeholder", callId),
            {
              id: "snapshot-placeholder-result",
              role: "tool",
              toolCallId: callId,
              content: "Forwarded to client",
            },
          ],
        },
        {
          type: EventType.RUN_FINISHED,
          threadId: "snapshot-placeholder-thread",
          runId: "x",
        },
      ],
    );
    const core = new CopilotKitCore({});
    await addAgent(core, agent);
    await core.runAgent({ agent });

    expect(
      agent.messages.filter(
        (message) => message.role === "tool" && message.toolCallId === callId,
      ),
    ).toEqual([
      expect.objectContaining({
        id: "snapshot-canonical",
        content: "canonical",
      }),
    ]);
  });

  it("removes a placeholder beside an existing real result", async () => {
    const callId = "call-multipart";
    const agent = new ScenarioAgent(
      "multipart",
      [
        owner("assistant-multipart", callId),
        {
          id: "existing-multipart-result",
          role: "tool",
          toolCallId: callId,
          content: "Forwarded to client",
        } as unknown as Message,
      ],
      [
        {
          type: EventType.RUN_STARTED,
          threadId: "multipart-thread",
          runId: "x",
        },
        result("real-result", callId, "canonical"),
        {
          type: EventType.RUN_FINISHED,
          threadId: "multipart-thread",
          runId: "x",
        },
      ],
    );
    const core = new CopilotKitCore({});
    await addAgent(core, agent);
    await core.runAgent({ agent });

    expect(
      agent.messages.filter(
        (message) => message.role === "tool" && message.toolCallId === callId,
      ),
    ).toEqual([
      expect.objectContaining({ id: "real-result", content: "canonical" }),
    ]);
  });

  it("reconciles a RUN_ERROR terminal and clears provenance at finalization", async () => {
    const callId = "call-error";
    const agent = new ScenarioAgent(
      "error-terminal",
      [owner("assistant-error", callId)],
      [
        {
          type: EventType.RUN_STARTED,
          threadId: "error-terminal-thread",
          runId: "x",
        },
        result("error-result", callId, "recovered after error"),
        {
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [owner("assistant-error", callId)],
        },
        {
          type: EventType.RUN_ERROR,
          threadId: "error-terminal-thread",
          runId: "x",
          message: "backend failed",
          code: "backend_error",
        },
      ],
    );
    const core = new CopilotKitCore({});
    await addAgent(core, agent);
    await core.runAgent({ agent });

    expect(agent.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "error-result",
          content: "recovered after error",
        }),
      ]),
    );
  });

  it("reconciles and finalizes a local run failure", async () => {
    const agent = new ScriptedWeatherAgent(false, true);
    const core = new CopilotKitCore({});
    await addAgent(core, agent);

    await core.runAgent({ agent });
    await expect(core.runAgent({ agent })).resolves.toBeDefined();
    expect(agent.secondTurnError).toBe("401 Unauthorized");

    expect(
      agent.messages.filter(
        (message) =>
          message.role === "tool" && message.toolCallId === toolCallId,
      ),
    ).toHaveLength(1);
  });

  it("keeps active ownership through a pre-start local failure", async () => {
    const agent = new LocalFailureBeforeStartAgent();
    const core = new CopilotKitCore({});
    await addAgent(core, agent);

    await core.runAgent({ agent });
    await expect(core.runAgent({ agent })).resolves.toBeDefined();

    agent.addMessage({
      id: "after-local-failure",
      role: "user",
      content: "still active",
    });
    expect(
      core.getRunIdForMessage(
        "local-failure",
        "local-failure-thread",
        "after-local-failure",
      ),
    ).toBe(agent.inputs[0]?.runId);
  });

  it("does not add a StateManager-owned result without an assistant owner", async () => {
    const callId = "call-ownerless";
    const agent = new ScenarioAgent(
      "ownerless",
      [],
      [
        {
          type: EventType.RUN_STARTED,
          threadId: "ownerless-thread",
          runId: "x",
        },
        result("ownerless-result", callId),
        {
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [],
        },
        {
          type: EventType.RUN_FINISHED,
          threadId: "ownerless-thread",
          runId: "x",
        },
      ],
    );
    const core = new CopilotKitCore({});
    await addAgent(core, agent);
    await core.runAgent({ agent });

    expect(
      agent.messages.filter((message) => message.id === "ownerless-result"),
    ).toHaveLength(0);
  });

  it("does not churn a live placeholder for a forwarded-to-client event", async () => {
    const callId = "call-forwarded";
    const agent = new ScenarioAgent(
      "forwarded",
      [
        owner("assistant-forwarded", callId),
        {
          id: "placeholder",
          role: "tool",
          toolCallId: callId,
          content: "Forwarded to client",
        },
      ],
      [
        {
          type: EventType.RUN_STARTED,
          threadId: "repeated-thread",
          runId: "x",
        },
        result("new-id", callId, "Forwarded to client"),
        {
          type: EventType.RUN_FINISHED,
          threadId: "repeated-thread",
          runId: "x",
        },
      ],
    );
    const core = new CopilotKitCore({});
    await addAgent(core, agent);
    await core.runAgent({ agent });

    expect(
      agent.messages.filter(
        (message) => message.role === "tool" && message.toolCallId === callId,
      ),
    ).toEqual([
      expect.objectContaining({
        id: "placeholder",
        content: "Forwarded to client",
      }),
    ]);
  });
});
