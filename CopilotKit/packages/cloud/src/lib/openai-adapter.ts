import OpenAI from "openai";
import { CopilotKitOpenAIConfiguration, CopilotKitServiceAdapter } from "../types/service-adapter";
import { limitOpenAIMessagesToTokenCount, maxTokensForOpenAIModel } from "../utils/openai";

const DEFAULT_MODEL = "gpt-4-1106-preview";

export class OpenAIAdapter implements CopilotKitServiceAdapter {
  constructor(private params: CopilotKitOpenAIConfiguration) {}

  stream(forwardedProps: any): ReadableStream {
    const openai = new OpenAI({
      apiKey: this.params.apiKey || process.env.OPENAI_API_KEY,
    });

    const messages = limitOpenAIMessagesToTokenCount(
      forwardedProps.messages || [],
      forwardedProps.functions || [],
      maxTokensForOpenAIModel(forwardedProps.model || DEFAULT_MODEL),
    );

    return openai.beta.chat.completions
      .stream({
        model: DEFAULT_MODEL,
        ...forwardedProps,
        stream: true,
        messages,
      })
      .toReadableStream();
  }
}
