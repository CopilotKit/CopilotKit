import { Action, parseChatCompletion, ToolCallPayload } from "@copilotkit/shared";
import {
  writeChatCompletionChunk,
  writeChatCompletionContent,
  writeChatCompletionEnd,
  writeChatCompletionResult,
} from "./openai";

/**
 * Execute a function call and write the result to the stream.
 * TODO: should this return a stream to get process other function calls?
 */
async function executeFunctionCall(
  controller: ReadableStreamDefaultController<any>,
  action: Action<any>,
  functionCallArguments: string,
): Promise<void> {
  // Prepare arguments for function calling
  let args: Record<string, any>[] = [];
  if (functionCallArguments) {
    args = JSON.parse(functionCallArguments);
  }

  // call the function
  const result = await action.handler(args);

  // We support several types of return values from functions:

  // 1. string
  // Just send the result as the content of the chunk.
  if (typeof result === "string") {
    writeChatCompletionResult(controller, action.name, result);
  }

  // 2. AIMessage
  // Send the content and function call of the AIMessage as the content of the chunk.
  else if ("content" in result && typeof result.content === "string") {
    writeChatCompletionContent(controller, result.content, result.additional_kwargs?.tool_calls);
  }

  // 3. BaseMessageChunk
  // Send the content and function call of the AIMessage as the content of the chunk.
  else if ("lc_kwargs" in result) {
    writeChatCompletionContent(controller, result.lc_kwargs?.content, result.lc_kwargs?.tool_calls);
  }

  // 4. IterableReadableStream
  // Stream the result of the LangChain function.
  else if ("getReader" in result) {
    let reader = result.getReader();
    while (true) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        writeChatCompletionContent(
          controller,
          value?.lc_kwargs?.content,
          value.lc_kwargs?.additional_kwargs?.tool_calls,
        );
      } catch (error) {
        console.error("Error reading from stream", error);
        break;
      }
    }
  }

  // 5. Any other type, return JSON result
  else {
    writeChatCompletionResult(controller, action.name, result);
  }
}

/**
 * This function decides what to handle server side and what to forward to the client.
 * It also handles the execution of server side functions.
 *
 * TODO: add proper error handling and logging
 */
export function copilotkitStreamInterceptor(
  stream: ReadableStream<Uint8Array>,
  actions: Action<any>[],
  debug: boolean = false,
): ReadableStream {
  const functionsByName = actions.reduce((acc, fn) => {
    acc[fn.name] = fn;
    return acc;
  }, {} as Record<string, Action<any>>);

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

  let currentFnIndex: number | null = null;

  const flushFunctionCall = async (
    controller: ReadableStreamDefaultController<any>,
  ): Promise<void> => {
    const action = functionsByName[functionCallName];
    await executeFunctionCall(controller, action, functionCallArguments);

    executeThisFunctionCall = false;
    functionCallName = "";
    functionCallArguments = "";
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
              await flushFunctionCall(controller);
            }
            writeChatCompletionEnd(controller);
            await cleanup(controller);
            return;
          } // done == true (terminal case)
          
          if (debug) {
            console.log("data: " + JSON.stringify(value) + "\n\n");
          }

          type Mode = 
            { type: "function"; toolCall: ToolCallPayload } |
            { type: "message"; associatedValue: string };

          let mode: Mode;
          const maybeToolCall = value.choices[0].delta.tool_calls?.[0]
          if (maybeToolCall) {
            mode = { type: "function", toolCall: maybeToolCall };
          } else {
            mode = { type: "message", associatedValue: value.choices[0].delta.content! };
          }

          const nextChunkIndex = mode.type === "function" ? mode.toolCall.index : null;
          // If We are in the middle of a function call and got a non function call chunk
          // or a different function call
          // => execute the function call first
          if (executeThisFunctionCall && (mode.type != "function" || nextChunkIndex != currentFnIndex)) {
            await flushFunctionCall(controller);
          }
          currentFnIndex = nextChunkIndex;

          // if we get a message, emit the content and continue;
          if (mode.type === "message") {
            if (value.choices[0].delta.content) {
              writeChatCompletionChunk(controller, value);
            }
            continue;
          }

          // if we get a function call, emit it only if we don't execute it server side
          else if (mode.type === "function") {
            // Set the function name if present
            const maybeFunctionName = mode.toolCall.function.name;
            if (maybeFunctionName) {
              functionCallName = maybeFunctionName
            }
            // If we have argument streamed back, add them to the function call arguments
            const maybeArguments = mode.toolCall.function.arguments;
            if (mode.toolCall.function.arguments) {
              functionCallArguments += maybeArguments
            }
            if (!executeThisFunctionCall) {
              // Decide if we should execute the function call server side
              if (functionCallName in functionsByName) {
                executeThisFunctionCall = true;
              }
            }
              mode.toolCall.function.scope = executeThisFunctionCall ? "server" : "client";
              writeChatCompletionChunk(controller, value);
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
