import {
  Message,
  ToolDefinition,
  ChatCompletionEvent,
  decodeChatCompletion,
  parseChatCompletion,
  decodeChatCompletionAsText,
  EXCLUDE_FROM_FORWARD_PROPS_KEYS,
} from "@copilotkit/shared";
import { CopilotApiConfig } from "../context";

export interface FetchChatCompletionParams {
  copilotConfig: CopilotApiConfig;
  model?: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  headers?: Record<string, string> | Headers;
  body?: object;
  signal?: AbortSignal;
}

export async function fetchChatCompletion({
  copilotConfig,
  model,
  messages,
  tools,
  temperature,
  headers,
  body,
  signal,
}: FetchChatCompletionParams): Promise<Response> {
  temperature ||= 0.5;
  tools ||= [];

  // clean up any extra properties from messages
  const cleanedMessages = messages.map((message) => {
    const { content, role, name, function_call } = message;
    return { content, role, name, function_call };
  });

  const response = await fetch(copilotConfig.chatApiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...copilotConfig.headers,
      ...(headers ? { ...headers } : {}),
    },
    body: JSON.stringify({
      model,
      messages: cleanedMessages,
      stream: true,
      ...(tools.length ? { tools } : {}),
      ...(temperature ? { temperature } : {}),
      ...(tools.length != 0 ? { tool_choice: "auto" } : {}),
      ...copilotConfig.body,
      ...copilotConfig.backendOnlyProps,
      ...excludeBackendOnlyProps(copilotConfig),
      ...(body ? { ...body } : {}),
      ...(copilotConfig.cloud ? { cloud: copilotConfig.cloud } : {}),
    }),
    signal,
  });

  return response;
}

function excludeBackendOnlyProps(copilotConfig: any) {
  const backendOnlyProps = copilotConfig.backendOnlyProps ?? {};
  if (Object.keys(backendOnlyProps).length > 0) {
    return {
      [EXCLUDE_FROM_FORWARD_PROPS_KEYS]: Object.keys(backendOnlyProps),
    };
  } else {
    return {};
  }
}

export interface DecodedChatCompletionResponse extends Response {
  events: ReadableStream<ChatCompletionEvent> | null;
}

export async function fetchAndDecodeChatCompletion(
  params: FetchChatCompletionParams,
): Promise<DecodedChatCompletionResponse> {
  const response = await fetchChatCompletion(params);
  if (!response.ok || !response.body) {
    (response as any).events = null;
  } else {
    const events = await decodeChatCompletion(parseChatCompletion(response.body));
    (response as any).events = events;
  }
  return response as any;
}

export interface DecodedChatCompletionResponseAsText extends Response {
  events: ReadableStream<string> | null;
}

export async function fetchAndDecodeChatCompletionAsText(
  params: FetchChatCompletionParams,
): Promise<DecodedChatCompletionResponseAsText> {
  const response = await fetchChatCompletion(params);
  if (!response.ok || !response.body) {
    (response as any).events = null;
  } else {
    const events = await decodeChatCompletionAsText(
      decodeChatCompletion(parseChatCompletion(response.body)),
    );
    (response as any).events = events;
  }

  return response as any;
}
