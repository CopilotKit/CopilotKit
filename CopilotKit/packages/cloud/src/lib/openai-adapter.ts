import OpenAI from "openai";
import { CopilotKitOpenAIConfiguration, CopilotKitServiceAdapter } from "../types/service-adapter";
import { limitOpenAIMessagesToTokenCount, maxTokensForOpenAIModel } from "../utils/openai";
import { AnnotatedFunction, parseChatCompletion } from "@copilotkit/shared";

const DEFAULT_MODEL = "gpt-4-1106-preview";

export class OpenAIAdapter implements CopilotKitServiceAdapter {
  constructor(private params: CopilotKitOpenAIConfiguration) {}

  stream(functions: AnnotatedFunction<any[]>[], forwardedProps: any): ReadableStream {
    const openai = new OpenAI({
      apiKey: this.params.apiKey || process.env.OPENAI_API_KEY,
    });

    const messages = limitOpenAIMessagesToTokenCount(
      forwardedProps.messages || [],
      forwardedProps.functions || [],
      maxTokensForOpenAIModel(forwardedProps.model || DEFAULT_MODEL),
    );

    // combine client and server defined functions
    let allFunctions = functions.map(annotatedFunctionToChatCompletionFunction);
    const serverFunctionNames = functions.map((fn) => fn.name);
    if (forwardedProps.functions) {
      allFunctions = allFunctions.concat(
        // filter out any client functions that are already defined on the server
        forwardedProps.functions.filter((fn: any) => !serverFunctionNames.includes(fn.name)),
      );
    }

    const stream = openai.beta.chat.completions
      .stream({
        model: DEFAULT_MODEL,
        ...forwardedProps,
        stream: true,
        messages: messages as any,
        ...(this.params.model ? { model: this.params.model } : {}),
        ...(allFunctions.length > 0 ? { functions: allFunctions } : {}),
      })
      .toReadableStream();
    return this.handleServerSideFunctions(stream, functions);
  }

  /**
   * This function decides what to handle server side and what to forward to the client.
   * It also handles the execution of server side functions.
   *
   * TODO: add proper error handling and logging
   */
  private handleServerSideFunctions(
    stream: ReadableStream<Uint8Array>,
    functions: AnnotatedFunction<any[]>[],
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
              if (executeThisFunctionCall) {
                // We are at the end of the stream and still have a function call to execute
                await executeFunctionCall();
              }
              const payload = new TextEncoder().encode("data: [DONE]\n\n");
              controller.enqueue(payload);
              await cleanup(controller);
              return;
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
            // TODO add -> data: as prefix
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
                  const payload = new TextEncoder().encode(
                    "data: " + JSON.stringify(value) + "\n\n",
                  );
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
}

// TODO proper type, maybe put it in shared
function annotatedFunctionToChatCompletionFunction(
  annotatedFunction: AnnotatedFunction<any[]>,
): any {
  // Create the parameters object based on the argumentAnnotations
  let parameters: { [key: string]: any } = {};
  for (let arg of annotatedFunction.argumentAnnotations) {
    // isolate the args we should forward inline
    let { name, required, ...forwardedArgs } = arg;
    parameters[arg.name] = forwardedArgs;
  }

  let requiredParameterNames: string[] = [];
  for (let arg of annotatedFunction.argumentAnnotations) {
    if (arg.required) {
      requiredParameterNames.push(arg.name);
    }
  }

  // Create the ChatCompletionFunctions object
  let chatCompletionFunction: any = {
    name: annotatedFunction.name,
    description: annotatedFunction.description,
    parameters: {
      type: "object",
      properties: parameters,
      required: requiredParameterNames,
    },
  };

  return chatCompletionFunction;
}
