import {
  Message,
  ToolDefinition,
  ChatCompletionChunk,
  TextMessage,
  ActionExecutionMessage,
  ResultMessage,
} from "@copilotkit/shared";

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
  let resultString = ResultMessage.encodeResult(result);

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
