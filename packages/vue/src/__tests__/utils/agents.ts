import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  AgentSubscriber,
  BaseEvent,
  Message,
  RunAgentInput,
  RunAgentParameters,
  RunAgentResult,
} from "@ag-ui/client";
import type { Suggestion } from "@copilotkit/core";
import { randomUUID } from "@copilotkit/shared";

export function toolCallMessage(
  toolCallName: string,
  args: unknown = {},
  id?: string,
): Message {
  return {
    id: id ?? randomUUID(),
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: randomUUID(),
        type: "function",
        function: {
          name: toolCallName,
          arguments: JSON.stringify(args),
        },
      },
    ],
  } as Message;
}

export class StateCapturingAgent extends AbstractAgent {
  public lastRunInput: RunAgentInput | undefined;
  private outcomes: RunAgentResult[];

  constructor(outcomes: RunAgentResult[] = [], agentId = "default") {
    super({ agentId });
    this.outcomes = [...outcomes];
  }

  run(): any {
    throw new Error("StateCapturingAgent.run() should not be used in tests");
  }

  enqueueOutcome(outcome: RunAgentResult): void {
    this.outcomes.push(outcome);
  }

  override clone(): StateCapturingAgent {
    const cloned = new StateCapturingAgent(
      this.outcomes,
      this.agentId ?? "default",
    );
    cloned.threadId = this.threadId;
    cloned.messages = JSON.parse(JSON.stringify(this.messages));
    cloned.state = JSON.parse(JSON.stringify(this.state));
    cloned.isRunning = this.isRunning;
    cloned.lastRunInput = this.lastRunInput
      ? JSON.parse(JSON.stringify(this.lastRunInput))
      : undefined;
    return cloned;
  }

  override async runAgent(
    parameters: RunAgentParameters = {},
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    const input = this.prepareRunAgentInput(parameters);
    this.lastRunInput = input;

    this.isRunning = true;
    await subscriber?.onRunInitialized?.({
      agent: this,
      messages: this.messages,
      state: this.state,
      input,
    });

    const outcome = this.outcomes.shift() ?? { newMessages: [] };

    if (outcome.newMessages.length > 0) {
      for (const msg of outcome.newMessages) {
        this.addMessage(msg);
      }
      await subscriber?.onMessagesChanged?.({
        agent: this,
        messages: this.messages,
        state: this.state,
        input,
      });
    }

    await subscriber?.onRunFinalized?.({
      agent: this,
      messages: this.messages,
      state: this.state,
      input,
    });

    this.isRunning = false;
    return outcome;
  }

  override async connectAgent(
    _parameters: RunAgentParameters = {},
    _subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    return { newMessages: [] };
  }
}

export class SuggestionsProviderAgent extends AbstractAgent {
  constructor(
    private responses: Suggestion[],
    agentId = "default",
  ) {
    super({ agentId });
  }

  setResponses(responses: Suggestion[]): void {
    this.responses = responses;
  }

  run(): any {
    throw new Error(
      "SuggestionsProviderAgent.run() should not be used in tests",
    );
  }

  override clone(): SuggestionsProviderAgent {
    const cloned = new SuggestionsProviderAgent(
      this.responses,
      this.agentId ?? "default",
    );
    cloned.threadId = this.threadId;
    cloned.messages = JSON.parse(JSON.stringify(this.messages));
    cloned.state = JSON.parse(JSON.stringify(this.state));
    cloned.isRunning = this.isRunning;
    return cloned;
  }

  override async runAgent(
    parameters: RunAgentParameters = {},
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    const input = this.prepareRunAgentInput(parameters);
    this.isRunning = true;

    await subscriber?.onRunInitialized?.({
      agent: this,
      messages: this.messages,
      state: this.state,
      input,
    });

    const suggestionMessage: Message = {
      id: randomUUID(),
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: randomUUID(),
          type: "function",
          function: {
            name: "copilotkitSuggest",
            arguments: JSON.stringify({ suggestions: this.responses }),
          },
        },
      ],
    } as Message;

    this.addMessage(suggestionMessage);

    await subscriber?.onMessagesChanged?.({
      agent: this,
      messages: this.messages,
      state: this.state,
      input,
    });

    await subscriber?.onRunFinalized?.({
      agent: this,
      messages: this.messages,
      state: this.state,
      input,
    });

    this.isRunning = false;
    return { newMessages: [suggestionMessage], result: undefined };
  }
}

export class SequencedRunAgent extends AbstractAgent {
  private handlers: Array<
    (input: RunAgentInput) => Promise<RunAgentResult> | RunAgentResult
  >;

  constructor(
    handlers: Array<
      (input: RunAgentInput) => Promise<RunAgentResult> | RunAgentResult
    >,
    agentId = "default",
  ) {
    super({ agentId });
    this.handlers = [...handlers];
  }

  run(): any {
    throw new Error("SequencedRunAgent.run() should not be used in tests");
  }

  override clone(): SequencedRunAgent {
    const cloned = new SequencedRunAgent(
      this.handlers,
      this.agentId ?? "default",
    );
    cloned.threadId = this.threadId;
    cloned.messages = JSON.parse(JSON.stringify(this.messages));
    cloned.state = JSON.parse(JSON.stringify(this.state));
    cloned.isRunning = this.isRunning;
    return cloned;
  }

  override async runAgent(
    parameters: RunAgentParameters = {},
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    const input = this.prepareRunAgentInput(parameters);
    this.isRunning = true;

    await subscriber?.onRunInitialized?.({
      agent: this,
      messages: this.messages,
      state: this.state,
      input,
    });

    const fn = this.handlers.shift();
    const outcome = fn ? await fn(input) : { newMessages: [] };

    for (const msg of outcome.newMessages) {
      this.addMessage(msg);
    }

    await subscriber?.onMessagesChanged?.({
      agent: this,
      messages: this.messages,
      state: this.state,
      input,
    });

    await subscriber?.onRunFinalized?.({
      agent: this,
      messages: this.messages,
      state: this.state,
      input,
    });

    this.isRunning = false;
    return outcome;
  }
}

export class MockStepwiseAgent extends AbstractAgent {
  private readonly streamSubscribers = new Set<{
    next?: (event: BaseEvent) => void;
    error?: (error: unknown) => void;
    complete?: () => void;
  }>();

  emit(event: BaseEvent): void {
    if (event.type === EventType.RUN_STARTED) {
      this.isRunning = true;
    } else if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      this.isRunning = false;
    }

    for (const subscriber of this.streamSubscribers) {
      subscriber.next?.(event);
    }
  }

  complete(): void {
    this.isRunning = false;
    for (const subscriber of this.streamSubscribers) {
      subscriber.complete?.();
    }
    this.streamSubscribers.clear();
  }

  override clone(): MockStepwiseAgent {
    const cloned = new (this.constructor as new () => MockStepwiseAgent)();
    cloned.agentId = this.agentId;
    (
      cloned as unknown as {
        streamSubscribers: Set<{
          next?: (event: BaseEvent) => void;
          error?: (error: unknown) => void;
          complete?: () => void;
        }>;
      }
    ).streamSubscribers = this.streamSubscribers;
    return cloned;
  }

  override run(_input: RunAgentInput): any {
    return {
      subscribe: (observer: {
        next?: (event: BaseEvent) => void;
        error?: (error: unknown) => void;
        complete?: () => void;
      }) => {
        this.streamSubscribers.add(observer);
        return {
          unsubscribe: () => {
            this.streamSubscribers.delete(observer);
          },
        };
      },
    };
  }
}

export class MockMCPProxyAgent extends MockStepwiseAgent {
  public runAgentCalls: Array<{ input: Partial<RunAgentInput> }> = [];
  private readonly runAgentResponses = new Map<string, unknown>();

  setRunAgentResponse(method: string, response: unknown): void {
    this.runAgentResponses.set(method, response);
  }

  override async runAgent(
    input?: Partial<RunAgentInput>,
  ): Promise<RunAgentResult> {
    const proxiedRequest = input?.forwardedProps?.__proxiedMCPRequest as
      | {
          serverHash?: string;
          serverId?: string;
          method: string;
          params?: Record<string, unknown>;
        }
      | undefined;

    if (!proxiedRequest) {
      return super.runAgent(input);
    }

    if (input) {
      this.runAgentCalls.push({ input });
    }

    const method = proxiedRequest.method;
    const response = this.runAgentResponses.get(method);
    if (response !== undefined) {
      return { result: response, newMessages: [] };
    }

    if (method === "resources/read") {
      return {
        result: {
          contents: [
            {
              uri: proxiedRequest.params?.uri,
              mimeType: "text/html",
              text: "<html><body>Test content</body></html>",
            },
          ],
        },
        newMessages: [],
      };
    }

    if (method === "tools/call") {
      return {
        result: {
          content: [{ type: "text", text: "Tool call result" }],
          isError: false,
        },
        newMessages: [],
      };
    }

    return { result: {}, newMessages: [] };
  }
}
