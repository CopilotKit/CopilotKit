/**
 * CopilotKit Adapter for Unify
 *
 * <RequestExample>
 * ```jsx CopilotRuntime Example
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(req, new UnifyAdapter());
 * ```
 * </RequestExample>
 *
 * You can easily set the model to use by passing it to the constructor.
 * ```jsx
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(
 *   req,
 *   new UnifyAdapter({ model: "llama-3-8b-chat@fireworks-ai" }),
 * );
 * ```
 */
import { nanoid } from "nanoid";
import { TextMessage } from "../../graphql/types/converted";
import {
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
  CopilotServiceAdapter,
} from "../service-adapter";
import OpenAI from "openai";

export interface UnifyAdapterParams {
  apiKey?: string;
}

export class UnifyAdapter implements CopilotServiceAdapter {
  private apiKey: string;

  constructor(options?: UnifyAdapterParams) {
    if (options?.apiKey) {
      this.apiKey = options.apiKey;
    } else {
      this.apiKey = "UNIFY_API_KEY";
    }
  }

  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const openai = new OpenAI({
      apiKey: this.apiKey,
      baseURL: "https://api.unify.ai/v0/"
    });

    const messages = (
      request.messages.filter((m) => m instanceof TextMessage) as TextMessage[]
    ).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const _stream = await openai.chat.completions.create({
      model: request.model,
      messages: messages,
      stream: true
    });

    request.eventSource.stream(async (eventStream$) => {
      eventStream$.sendTextMessageStart(nanoid());
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
      threadId: request.threadId || nanoid(),
    };
  }
}
