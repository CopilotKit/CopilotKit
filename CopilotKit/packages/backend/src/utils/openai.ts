import { Message, ToolDefinition, ChatCompletionChunk } from "@copilotkit/shared";
import { AnnotatedFunction, parseChatCompletion } from "@copilotkit/shared";

export function writeChatCompletionChunk(
  controller: ReadableStreamDefaultController<any>,
  chunk: ChatCompletionChunk,
) {
  const payload = new TextEncoder().encode("data: " + JSON.stringify(chunk) + "\n\n");
  controller!.enqueue(payload);
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

/**
 * This function decides what to handle server side and what to forward to the client.
 * It also handles the execution of server side functions.
 *
 * TODO: add proper error handling and logging
 */
export function copilotkitStreamInterceptor(
  stream: ReadableStream<Uint8Array>,
  functions: AnnotatedFunction<any[]>[],
  debug: boolean = false,
): ReadableStream {
  const functionsByName = functions.reduce((acc, fn) => {
    acc[fn.name] = fn;
    return acc;
  }, {} as Record<string, AnnotatedFunction<any[]>>);

  const decodedStream = parseChatCompletion(stream);
  const reader = decodedStream.getReader();

  async function cleanup(controller?: ReadableStreamDefaultController<any>) {
    if (controller) {
      try {
        controller.close();
      } catch (_) {}
    }
    if (reader) {
      try {
        await reader.cancel();
      } catch (_) {}
    }
  }

  // Keep track of current state as we process the stream

  // Loop Invariant:
  // Either we are in the middle of a function call that should be executed on the backend = TRUE
  // or we are in the middle of processing a chunk that should be forwarded to the client = FALSE
  let executeThisFunctionCall = false;

  let functionCallName = "";
  let functionCallArguments = "";

  let currentFnIndex = 0;

  const executeFunctionCall = async (): Promise<boolean> => {
    const fn = functionsByName[functionCallName];
    let args: Record<string, any>[] = [];
    if (functionCallArguments) {
      args = JSON.parse(functionCallArguments);
    }
    const paramsInCorrectOrder: any[] = [];
    for (let arg of fn.argumentAnnotations) {
      paramsInCorrectOrder.push(args[arg.name as keyof typeof args]);
    }
    await fn.implementation(...paramsInCorrectOrder);

    executeThisFunctionCall = false;

    functionCallName = "";
    functionCallArguments = "";
    return true;
  };

  return new ReadableStream({
    async pull(controller) {
      while (true) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            if (debug) {
              console.log("data: [DONE]\n\n");
            }
            if (executeThisFunctionCall) {
              // We are at the end of the stream and still have a function call to execute
              await executeFunctionCall();
            }
            writeChatCompletionEnd(controller);
            await cleanup(controller);
            return;
          } else if (debug) {
            console.log("data: " + JSON.stringify(value) + "\n\n");
          }

          let mode: "function" | "message" = value.choices[0].delta.tool_calls
            ? "function"
            : "message";

          const index = (value.choices[0].delta.tool_calls?.[0]?.index || 0) as number;

          // We are in the middle of a function call and got a non function call chunk
          // or a different function call
          // => execute the function call first
          if (executeThisFunctionCall && (mode != "function" || index != currentFnIndex)) {
            await executeFunctionCall();
          }

          currentFnIndex = index;

          // if we get a message, emit the content and continue;
          if (mode === "message") {
            if (value.choices[0].delta.content) {
              writeChatCompletionChunk(controller, value);
            }
            continue;
          }
          // if we get a function call, emit it only if we don't execute it server side
          else if (mode === "function") {
            // Set the function name if present
            if (value.choices[0].delta.tool_calls?.[0]?.function?.name) {
              functionCallName = value.choices[0].delta.tool_calls![0].function.name!;
            }
            // If we have argument streamed back, add them to the function call arguments
            if (value.choices[0].delta.tool_calls?.[0]?.function?.arguments) {
              functionCallArguments += value.choices[0].delta.tool_calls![0].function.arguments!;
            }
            if (!executeThisFunctionCall) {
              // Decide if we should execute the function call server side

              if (!(functionCallName in functionsByName)) {
                // Just forward the function call to the client
                writeChatCompletionChunk(controller, value);
              } else {
                // Execute the function call server side
                executeThisFunctionCall = true;
              }
            }
            continue;
          }
        } catch (error) {
          controller.error(error);
          return;
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}
