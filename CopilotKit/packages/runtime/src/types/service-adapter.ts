import { MessageInput } from "../graphql/inputs/message.input";

export interface CopilotKitResponse {
  stream: ReadableStream;
  headers?: Record<string, string>;
}

export interface CopilotRuntimeChatCompletionRequest {
  model?: string;

  // TODO-PROTOCOL: replace any with a more specific type once we have it in graphql
  tools?: any[];
  messages: MessageInput[];
  threadId?: string;
}

export interface CopilotRuntimeChatCompletionResponse {
  stream: ReadableStream;
  threadId?: string;
  runId?: string;
}

export interface CopilotKitServiceAdapter {
  // getResponse(forwardedProps: any): Promise<CopilotKitResponse>;
  process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse>;
}
