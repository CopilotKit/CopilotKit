import { Message, ToolDefinition, ChatCompletionChunk, encodeResult } from "@copilotkit/shared";

export function writeChatCompletionChunk(
  controller: ReadableStreamDefaultController<any>,
  chunk: ChatCompletionChunk,
) {
  const payload = new TextEncoder().encode("data: " + JSON.stringify(chunk) + "\n\n");
  controller!.enqueue(payload);
}

export function writeChatCompletionContent(
  controller: ReadableStreamDefaultController<any>,
  content: string = "",
  toolCalls?: any,
) {
  const chunk: ChatCompletionChunk = {
    choices: [
      {
        delta: {
          role: "assistant",
          content: content,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
  };

  writeChatCompletionChunk(controller, chunk);
}

export function writeChatCompletionResult(
  controller: ReadableStreamDefaultController<any>,
  functionName: string,
  result: any,
) {
  let resultString = encodeResult(result);

  const chunk: ChatCompletionChunk = {
    choices: [
      {
        delta: {
          role: "function",
          content: resultString,
          name: functionName,
        },
      },
    ],
  };

  writeChatCompletionChunk(controller, chunk);
}

export function writeChatCompletionEnd(controller: ReadableStreamDefaultController<any>) {
  const payload = new TextEncoder().encode("data: [DONE]\n\n");
  controller.enqueue(payload);
}

export function limitOpenAIMessagesToTokenCount(
  messages: Message[],
  tools: ToolDefinition[],
  maxTokens: number,
): Message[] {
  const result: Message[] = [];
  const toolsNumTokens = countToolsTokens(tools);
  if (toolsNumTokens > maxTokens) {
    throw new Error(`Too many tokens in function definitions: ${toolsNumTokens} > ${maxTokens}`);
  }
  maxTokens -= toolsNumTokens;

  for (const message of messages) {
    if (message.role === "system") {
      const numTokens = countMessageTokens(message);
      maxTokens -= numTokens;

      if (maxTokens < 0) {
        throw new Error("Not enough tokens for system message.");
      }
    }
  }

  let cutoff: boolean = false;

  const reversedMessages = [...messages].reverse();
  for (const message of reversedMessages) {
    if (message.role === "system") {
      result.unshift(message);
      continue;
    } else if (cutoff) {
      continue;
    }
    let numTokens = countMessageTokens(message);
    if (maxTokens < numTokens) {
      cutoff = true;
      continue;
    }
    result.unshift(message);
    maxTokens -= numTokens;
  }

  return result;
}

export function maxTokensForOpenAIModel(model: string): number {
  return maxTokensByModel[model] || DEFAULT_MAX_TOKENS;
}

const DEFAULT_MAX_TOKENS = 8192;

const maxTokensByModel: { [key: string]: number } = {
  // GPT-4
  "gpt-4o": 128000,
  "gpt-4o-2024-05-13": 128000,
  "gpt-4-turbo": 128000,
  "gpt-4-turbo-2024-04-09": 128000,
  "gpt-4-0125-preview": 128000,
  "gpt-4-turbo-preview": 128000,
  "gpt-4-1106-preview": 128000,
  "gpt-4-vision-preview": 128000,
  "gpt-4-1106-vision-preview": 128000,
  "gpt-4-32k": 32768,
  "gpt-4-32k-0613": 32768,
  "gpt-4-32k-0314": 32768,
  "gpt-4": 8192,
  "gpt-4-0613": 8192,
  "gpt-4-0314": 8192,

  // GPT-3.5
  "gpt-3.5-turbo-0125": 16385,
  "gpt-3.5-turbo": 16385,
  "gpt-3.5-turbo-1106": 16385,
  "gpt-3.5-turbo-instruct": 4096,
  "gpt-3.5-turbo-16k": 16385,
  "gpt-3.5-turbo-0613": 4096,
  "gpt-3.5-turbo-16k-0613": 16385,
  "gpt-3.5-turbo-0301": 4097,
};

function countToolsTokens(functions: ToolDefinition[]): number {
  if (functions.length === 0) {
    return 0;
  }
  const json = JSON.stringify(functions);
  return countTokens(json);
}

function countMessageTokens(message: Message): number {
  if (message.content) {
    return countTokens(message.content);
  } else if (message.function_call) {
    return countTokens(JSON.stringify(message.function_call));
  }
  return 0;
}

function countTokens(text: string): number {
  return text.length / 3;
}
