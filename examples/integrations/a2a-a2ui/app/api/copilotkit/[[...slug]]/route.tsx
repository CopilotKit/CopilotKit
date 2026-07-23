import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import type {
  AgentSubscriber,
  RunAgentInput,
  RunAgentParameters,
  RunAgentResult,
} from "@ag-ui/client";
import { handle } from "hono/vercel";
import { A2AAgent } from "@ag-ui/a2a";
import type { A2AAgentConfig } from "@ag-ui/a2a";
import { A2AClient } from "@a2a-js/sdk/client";

const a2aClient = new A2AClient("http://localhost:10002");

type RuntimeRunAgentInput = RunAgentParameters &
  Partial<Pick<RunAgentInput, "messages" | "state" | "threadId">>;

class RuntimeA2AAgent extends A2AAgent {
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

const agent = new RuntimeA2AAgent({ a2aClient });

const runtime = new CopilotRuntime({
  agents: {
    default: agent,
  },
  a2ui: {},
  // --- copilotkit:intelligence (remove this block to opt out) ---
  ...(process.env.COPILOTKIT_LICENSE_TOKEN
    ? {
        intelligence: new CopilotKitIntelligence({
          apiKey: process.env.INTELLIGENCE_API_KEY ?? "",
          apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4201",
          wsUrl:
            process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4401",
        }),
        // Demo stub — replace with your own auth-derived user identity (e.g. OIDC)
        // before any multi-user deployment, or all users share one thread history.
        identifyUser: () => ({ id: "demo-user", name: "Demo User" }),
        licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
      }
    : { runner: new InMemoryAgentRunner() }),
  // --- /copilotkit:intelligence ---
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
