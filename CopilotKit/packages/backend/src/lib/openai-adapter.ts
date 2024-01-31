import OpenAI from "openai";
import { CopilotKitServiceAdapter } from "../types/service-adapter";
import { limitOpenAIMessagesToTokenCount, maxTokensForOpenAIModel } from "../utils/openai";
import { AnnotatedFunction, annotatedFunctionToChatCompletionFunction } from "@copilotkit/shared";
import { openaiStreamInterceptor } from "../utils";

const DEFAULT_MODEL = "gpt-4-1106-preview";

export interface OpenAIAdapterParams {
  openai?: OpenAI;
  model?: string;
  debug?: boolean;
}

export class OpenAIAdapter implements CopilotKitServiceAdapter {
  private openai: OpenAI;
  private model: string = DEFAULT_MODEL;
  private debug: boolean = false;
  constructor(params?: OpenAIAdapterParams) {
    this.openai = params?.openai || new OpenAI({});
    if (params?.model) {
      this.model = params.model;
    }
    if (params?.debug) {
      this.debug = params.debug;
    }
  }

  stream(functions: AnnotatedFunction<any[]>[], forwardedProps: any): ReadableStream {
    const messages = limitOpenAIMessagesToTokenCount(
      forwardedProps.messages || [],
      forwardedProps.tools || [],
      maxTokensForOpenAIModel(forwardedProps.model || DEFAULT_MODEL),
    );

    // combine client and server defined tools
    let allTools = functions.map(annotatedFunctionToChatCompletionFunction);
    const serverFunctionNames = functions.map((fn) => fn.name);
    if (forwardedProps.tools) {
      allTools = allTools.concat(
        // filter out any client functions that are already defined on the server
        forwardedProps.tools.filter((fn: any) => !serverFunctionNames.includes(fn.name)),
      );
    }

    console.log({
      model: this.model,
      ...forwardedProps,
      stream: true,
      messages: messages as any,
      ...(allTools.length > 0 ? { tools: allTools } : {}),
    });

    const stream = this.openai.beta.chat.completions
      .stream({
        model: this.model,
        ...forwardedProps,
        stream: true,
        messages: messages as any,
        ...(allTools.length > 0 ? { tools: allTools } : {}),
      })
      .toReadableStream();
    return openaiStreamInterceptor(stream, functions, this.debug);
  }
}
