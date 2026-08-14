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

class PreStartRunErrorAgent extends AbstractAgent {
  readonly inputs: RunAgentInput[] = [];

  constructor() {
    super({ agentId: "pre-start-error", threadId: "pre-start-thread" });
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

    return from([
      {
        type: EventType.RUN_ERROR,
        threadId: this.threadId,
        runId: input.runId,
        message: "failed before start",
        code: "pre_start_failure",
      },
    ] as BaseEvent[]);
  }
}

const owner = (id: string, callId: string) => ({
  id,
  role: "assistant" as const,
  content: "",
  toolCalls: [
    {
      id: callId,
      type: "function" as const,
      function: { name: "tool", arguments: "{}" },
    },
  ],
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
        result("result-a", callId, "a"),
        {
          type: EventType.RUN_FINISHED,
          threadId: "duplicate-thread",
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
    ).toEqual([expect.objectContaining({ id: "result-a", content: "a" })]);
    expect(
      core.getRunIdForMessage("duplicate", "duplicate-thread", "result-a"),
    ).toBe(agent.inputs[0]?.runId);
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

  it("preserves a real multi-part result beside a distinct canonical result", async () => {
    const callId = "call-multipart";
    const agent = new ScenarioAgent(
      "multipart",
      [
        owner("assistant-multipart", callId),
        {
          id: "existing-multipart-result",
          role: "tool",
          toolCallId: callId,
          content: [
            { type: "text", text: "Forwarded to client" },
            " plus more",
          ],
        } as unknown as Message,
      ],
      [
        {
          type: EventType.RUN_STARTED,
          threadId: "multipart-thread",
          runId: "x",
        },
        result("multipart-result", callId, "canonical"),
        {
          type: EventType.RUN_FINISHED,
          threadId: "multipart-thread",
          runId: "x",
        },
      ],
    );
    const core = new CopilotKitCore({});
    await addAgent(core, agent);
    let deliveredToLaterSubscriber = 0;
    agent.subscribe({
      onToolCallResultEvent: () => {
        deliveredToLaterSubscriber++;
      },
    });
    await core.runAgent({ agent });

    expect(
      agent.messages.filter(
        (message) => message.role === "tool" && message.toolCallId === callId,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "existing-multipart-result",
          content: [
            { type: "text", text: "Forwarded to client" },
            " plus more",
          ] as unknown as string,
        }),
        expect.objectContaining({
          id: "multipart-result",
          content: "canonical",
        }),
      ]),
    );
    expect(deliveredToLaterSubscriber).toBe(1);
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

  it("does not reconcile a finalized input's old result provenance", async () => {
    const agent = new ScriptedWeatherAgent();
    const core = new CopilotKitCore({});
    await addAgent(core, agent);
    await core.runAgent({ agent });

    const stateManagerSubscriber = (
      agent as unknown as {
        subscribers: Array<{
          onRunFinishedEvent?: (params: unknown) => unknown;
          onRunFinalized?: (params: unknown) => unknown;
        }>;
      }
    ).subscribers.find(
      (subscriber) =>
        subscriber.onRunFinishedEvent && subscriber.onRunFinalized,
    );
    expect(stateManagerSubscriber).toBeDefined();

    const input = agent.inputs[0]!;
    const messagesWithoutResult = agent.messages.filter(
      (message) => message.id !== "result-weather",
    );
    const mutation = stateManagerSubscriber!.onRunFinishedEvent!({
      input,
      messages: messagesWithoutResult,
      state: {},
      agent,
      event: {
        type: EventType.RUN_FINISHED,
        threadId,
        runId: input.runId,
      },
    });

    expect(mutation).toBeUndefined();
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

  it("keeps distinct result identities from one input and cleans provenance at finalization", async () => {
    const callId = "call-repeated";
    const agent = new ScenarioAgent(
      "repeated",
      [owner("assistant-repeated", callId)],
      [
        {
          type: EventType.RUN_STARTED,
          threadId: "repeated-thread",
          runId: "x",
        },
        result("result-shared-1", callId, "one"),
        result("result-shared-2", callId, "two"),
        {
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [owner("assistant-repeated", callId)],
        },
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

    expect(agent.messages.filter((message) => message.role === "tool")).toEqual(
      [
        expect.objectContaining({ id: "result-shared-1", content: "one" }),
        expect.objectContaining({ id: "result-shared-2", content: "two" }),
      ],
    );
  });

  it("keeps the previous active run when a different input errors before RUN_STARTED", async () => {
    const agent = new PreStartRunErrorAgent();
    const core = new CopilotKitCore({});
    await addAgent(core, agent);
    await core.runAgent({ agent });
    await expect(core.runAgent({ agent })).resolves.toBeDefined();

    agent.addMessage({
      id: "after-pre-start-error",
      role: "user",
      content: "still active",
    });
    expect(
      core.getRunIdForMessage(
        "pre-start-error",
        "pre-start-thread",
        "after-pre-start-error",
      ),
    ).toBe(agent.inputs[0]?.runId);
  });
});
