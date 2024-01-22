import { AnnotatedFunction, parseChatCompletion } from "@copilotkit/shared";

/**
 * This function decides what to handle server side and what to forward to the client.
 * It also handles the execution of server side functions.
 *
 * TODO: add proper error handling and logging
 */
export function openaiStreamInterceptor(
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
            const payload = new TextEncoder().encode("data: [DONE]\n\n");
            controller.enqueue(payload);
            await cleanup(controller);
            return;
          } else if (debug) {
            console.log("data: " + JSON.stringify(value) + "\n\n");
          }

          // We are in the middle of a function call and got a non function call chunk
          // so we need to execute the function call first
          if (executeThisFunctionCall && !value.choices[0].delta.function_call) {
            if (!(await executeFunctionCall())) {
              return;
            }
          }

          let mode: "function" | "message" = value.choices[0].delta.function_call
            ? "function"
            : "message";

          // if we get a message, emit the content and continue;
          if (mode === "message") {
            if (value.choices[0].delta.content) {
              const payload = new TextEncoder().encode("data: " + JSON.stringify(value) + "\n\n");
              controller.enqueue(payload);
            }
            continue;
          }
          // if we get a function call, emit it only if we don't execute it server side
          else if (mode === "function") {
            // Set the function name if present
            if (value.choices[0].delta.function_call!.name) {
              functionCallName = value.choices[0].delta.function_call!.name!;
            }
            // If we have argument streamed back, add them to the function call arguments
            if (value.choices[0].delta.function_call!.arguments) {
              functionCallArguments += value.choices[0].delta.function_call!.arguments!;
            }
            if (!executeThisFunctionCall) {
              // Decide if we should execute the function call server side

              if (!(functionCallName in functionsByName)) {
                // Just forward the function call to the client
                const payload = new TextEncoder().encode("data: " + JSON.stringify(value) + "\n\n");
                controller.enqueue(payload);
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
