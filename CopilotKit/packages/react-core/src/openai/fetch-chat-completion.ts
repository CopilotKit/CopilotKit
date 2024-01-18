import { Message, Function } from "@copilotkit/shared";
import { CopilotApiConfig } from "../context";

const DEFAULT_MODEL = "gpt-4-1106-preview";

export interface FetchChatCompletionParams {
  copilotConfig: CopilotApiConfig;
  model?: string;
  messages: Message[];
  functions?: Function[];
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
  functions,
  temperature,
  headers,
  body,
  signal,
}: FetchChatCompletionParams): Promise<Response> {
  temperature ||= 0.5;
  functions ||= [];
  model ||= DEFAULT_MODEL;

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
      ...(functions.length ? { functions } : {}),
      ...(temperature ? { temperature } : {}),
      ...(functions.length != 0 ? { function_call: "auto" } : {}),
      ...copilotConfig.body,
      ...(body ? { ...body } : {}),
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    return response;
  }

  const reader = response.body.getReader();
  const buffer = new Uint8Array();

  async function cleanup() {
    if (reader) {
      try {
        await reader.cancel();
      } catch (error) {
        console.warn("Failed to cancel reader:", error);
      }
    }
  }

  const stream = new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // TODO Process any remaining buffer
          controller.close();
          return;
        }

        // TODO Process value
      }
    },
  });

  return new Response(stream, {
    headers: response.headers,
  });
}
