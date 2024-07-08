/**
 * CopilotKit Adapter for Groq
 *
 * <RequestExample>
 * ```jsx CopilotRuntime Example
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(req, new GroqAdapter());
 * ```
 * </RequestExample>
 *
 * You can easily set the model to use by passing it to the constructor.
 * ```jsx
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(
 *   req,
 *   new GroqAdapter({ model: "llama3-70b-8192" }),
 * );
 * ```
 */
import { TextMessage } from "../../../graphql/types/converted";
import {
  CopilotServiceAdapter,
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../../service-adapter";
import { randomId } from "@copilotkit/shared";

import Groq from "groq-sdk";

const DEFAULT_MODEL = "llama3-70b-8192";

interface GroqAdapterOptions {
  model?: string;
}

export class ExperimentalGroqAdapter implements CopilotServiceAdapter {
  private model: string;

  constructor(options?: GroqAdapterOptions) {
    if (options?.model) {
      this.model = options.model;
    } else {
      this.model = DEFAULT_MODEL;
    }
  }

  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const groq = new Groq();

    const messages = (
      request.messages.filter((m) => m instanceof TextMessage) as TextMessage[]
    ).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const max_tokens = maxTokensForGroqModel(this.model);

    const _stream = await groq.chat.completions.create({
      //
      // Required parameters
      //
      messages: messages,

      // The language model which will generate the completion.
      model: this.model,

      //
      // Optional parameters
      //

      // Controls randomness: lowering results in less random completions.
      // As the temperature approaches zero, the model will become deterministic
      // and repetitive.
      temperature: 0.5, // [TODO]

      // The maximum number of tokens to generate. Requests can use up to
      // 2048 tokens shared between prompt and completion.
      max_tokens: max_tokens,

      // Controls diversity via nucleus sampling: 0.5 means half of all
      // likelihood-weighted options are considered.
      top_p: 1, // [TODO]

      // A stop sequence is a predefined or user-specified text string that
      // signals an AI to stop generating content, ensuring its responses
      // remain focused and concise. Examples include punctuation marks and
      // markers like "[end]".
      stop: null,

      // If set, partial message deltas will be sent.
      stream: true,
    });

    request.eventSource.stream(async (eventStream$) => {
      eventStream$.sendTextMessageStart(randomId());
      for await (const chunk of _stream) {
        if (chunk.choices[0]?.delta?.content) {
          eventStream$.sendTextMessageContent(chunk.choices[0]?.delta?.content);
        }
      }
      eventStream$.sendTextMessageEnd();
      // we may need to add this later.. [nc]
      // let calls = (await result.response).functionCalls();

      eventStream$.complete();
    });
    return {
      threadId: request.threadId || randomId(),
    };
  }
}

export function maxTokensForGroqModel(model: string): number {
  return maxTokensByModel[model] || DEFAULT_MAX_TOKENS;
}

const DEFAULT_MAX_TOKENS = 8192;

const maxTokensByModel: { [key: string]: number } = {
  // llama3
  "llama3-8b-8192": DEFAULT_MAX_TOKENS,
  "llama3-70b-8192": DEFAULT_MAX_TOKENS,
};
