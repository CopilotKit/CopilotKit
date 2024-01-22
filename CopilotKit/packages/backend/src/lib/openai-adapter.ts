import OpenAI from "openai";
import { CopilotKitServiceAdapter } from "../types/service-adapter";
import { limitOpenAIMessagesToTokenCount, maxTokensForOpenAIModel } from "../utils/openai";
import { AnnotatedFunction, annotatedFunctionToChatCompletionFunction } from "@copilotkit/shared";
import { openaiStreamInterceptor } from "../utils";

const DEFAULT_MODEL = "gpt-4-1106-preview";

export class OpenAIAdapter implements CopilotKitServiceAdapter {
  constructor(
    private openai: OpenAI = new OpenAI({}),
    private model: string = DEFAULT_MODEL,
    private debug: boolean = false,
  ) {}

  stream(functions: AnnotatedFunction<any[]>[], forwardedProps: any): ReadableStream {
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

    const stream = this.openai.beta.chat.completions
      .stream({
        model: this.model,
        ...forwardedProps,
        stream: true,
        messages: messages as any,
        ...(allFunctions.length > 0 ? { functions: allFunctions } : {}),
      })
      .toReadableStream();
    return openaiStreamInterceptor(stream, functions, this.debug);
  }
}
