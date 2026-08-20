/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — CopilotRuntimeChatCompletionRequest:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — CopilotRuntimeChatCompletionResponse:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — CopilotServiceAdapter:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/runtime/src/service-adapters/service-adapter.ts
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

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
