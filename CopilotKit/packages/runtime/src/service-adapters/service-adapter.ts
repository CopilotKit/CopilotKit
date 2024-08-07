import { Message } from "../graphql/types/converted";
import { RuntimeEventSource } from "./events";
import { ActionInput } from "../graphql/inputs/action.input";
import { ForwardedParametersInput } from "../graphql/inputs/forwarded-parameters.input";

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
}

export interface CopilotRuntimeChatCompletionResponse {
  threadId: string;
  runId?: string;
}

export interface CopilotServiceAdapter {
  process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse>;
}
