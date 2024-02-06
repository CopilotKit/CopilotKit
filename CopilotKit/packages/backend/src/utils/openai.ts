import { Message, ToolDefinition, ChatCompletionChunk } from "@copilotkit/shared";

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
  let resultString = "";
  if (result !== undefined) {
    resultString = typeof result === "string" ? result : JSON.stringify(result);
  }

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
  "gpt-3.5-turbo": 4097,
  "gpt-3.5-turbo-16k": 16385,
  "gpt-4": 8192,
  "gpt-4-1106-preview": 8192,
  "gpt-4-32k": 32768,
  "gpt-3.5-turbo-0301": 4097,
  "gpt-4-0314": 8192,
  "gpt-4-32k-0314": 32768,
  "gpt-3.5-turbo-0613": 4097,
  "gpt-4-0613": 8192,
  "gpt-4-32k-0613": 32768,
  "gpt-3.5-turbo-16k-0613": 16385,
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
