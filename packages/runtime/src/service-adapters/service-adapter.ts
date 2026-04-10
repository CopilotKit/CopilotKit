import type { LanguageModel } from "ai";
import type { Message } from "../graphql/types/converted";
import type { RuntimeEventSource } from "./events";
import type { ActionInput } from "../graphql/inputs/action.input";
import type { ForwardedParametersInput } from "../graphql/inputs/forwarded-parameters.input";
import type { ExtensionsInput } from "../graphql/inputs/extensions.input";
import type { ExtensionsResponse } from "../graphql/types/extensions-response.type";
import type { AgentSessionInput } from "../graphql/inputs/agent-session.input";
import type { AgentStateInput } from "../graphql/inputs/agent-state.input";

export interface CopilotKitResponse {
  stream: ReadableStream;
  headers?: Record<string, string>;
}

export interface CopilotRuntimeChatCompletionRequest {
  eventSource: RuntimeEventSource;
  messages: Message[];
  actions: ActionInput[];
  model?: string;
  threadId?: string;
  runId?: string;
  forwardedParameters?: ForwardedParametersInput;
  extensions?: ExtensionsInput;
  agentSession?: AgentSessionInput;
  agentStates?: AgentStateInput[];
}

export interface CopilotRuntimeChatCompletionResponse {
  threadId: string;
  runId?: string;
  extensions?: ExtensionsResponse;
}

export interface CopilotServiceAdapter {
  provider?: string;
  model?: string;
  process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse>;
  name?: string;

  /**
   * Returns a pre-configured LanguageModel for use with BuiltInAgent.
   * Adapters that support custom provider configurations (e.g., Azure OpenAI
   * with custom baseURL/apiKey) should implement this to ensure the
   * configuration is propagated to the agent layer.
   */
  getLanguageModel?(): LanguageModel;
}
