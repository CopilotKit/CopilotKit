import type { LanguageModel } from "ai";
import { Message } from "../graphql/types/converted";
import { RuntimeEventSource } from "./events";
import { ActionInput } from "../graphql/inputs/action.input";
import { ForwardedParametersInput } from "../graphql/inputs/forwarded-parameters.input";
import { ExtensionsInput } from "../graphql/inputs/extensions.input";
import { ExtensionsResponse } from "../graphql/types/extensions-response.type";
import { AgentSessionInput } from "../graphql/inputs/agent-session.input";
import { AgentStateInput } from "../graphql/inputs/agent-state.input";

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
