import {
  AbstractAgent,
  type AgentSubscriber,
  type BaseEvent,
  type Message,
  type RunAgentInput,
  type RunAgentParameters,
  type RunAgentResult,
} from "@ag-ui/client";
import type { Suggestion } from "@copilotkitnext/core";
import { randomUUID } from "@copilotkitnext/shared";
import { Observable } from "rxjs";

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

  run(): Observable<BaseEvent> {
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

  run(): Observable<BaseEvent> {
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

  run(): Observable<BaseEvent> {
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
