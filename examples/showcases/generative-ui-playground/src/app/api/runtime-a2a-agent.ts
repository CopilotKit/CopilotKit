import type {
  AgentSubscriber,
  RunAgentInput,
  RunAgentParameters,
  RunAgentResult,
} from "@ag-ui/client";
import { A2AAgent } from "@ag-ui/a2a";
import type { A2AAgentConfig } from "@ag-ui/a2a";
import type { A2AClient } from "@a2a-js/sdk/client";

type RuntimeRunAgentInput = RunAgentParameters &
  Partial<Pick<RunAgentInput, "messages" | "state" | "threadId">>;

export class RuntimeA2AAgent extends A2AAgent {
  private readonly client: A2AClient;

  constructor(config: A2AAgentConfig) {
    super(config);
    this.client = config.a2aClient;
  }

  async runAgent(
    parameters: RuntimeRunAgentInput = {},
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    const isolatedAgent = new A2AAgent({
      a2aClient: this.client,
      agentId: this.agentId,
      debug: this.debug,
      description: this.description,
      initialMessages: this.messages,
      initialState: this.state,
      threadId: this.threadId,
    });

    if (parameters.threadId) {
      isolatedAgent.threadId = parameters.threadId;
    }

    if (parameters.state) {
      isolatedAgent.setState(parameters.state);
    }

    if (parameters.messages) {
      isolatedAgent.setMessages(parameters.messages);
    }

    return isolatedAgent.runAgent(
      {
        context: parameters.context,
        forwardedProps: parameters.forwardedProps,
        runId: parameters.runId,
        tools: parameters.tools,
      },
      subscriber,
    );
  }

  clone(): RuntimeA2AAgent {
    return new RuntimeA2AAgent({
      a2aClient: this.client,
      agentId: this.agentId,
      debug: this.debug,
      description: this.description,
      initialMessages: this.messages,
      initialState: this.state,
      threadId: this.threadId,
    });
  }
}
