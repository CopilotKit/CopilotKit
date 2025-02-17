/**
 * CopilotKit Adapter for Ollama
 *
 * <RequestExample>
 * ```jsx CopilotRuntime Example
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(req, new OllamaAdapter());
 * ```
 * </RequestExample>
 *
 * You can easily set the model to use by passing it to the constructor.
 * ```jsx
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(
 *   req,
 *   new OllamaAdapter({ model: "llama3-70b-8192" }),
 * );
 * ```
 */
import { TextMessage } from "../../../graphql/types/converted";
import {
  CopilotServiceAdapter,
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../../service-adapter";
import { Ollama } from "@langchain/community/llms/ollama";
import { randomId, randomUUID } from "@copilotkit/shared";

const DEFAULT_MODEL = "llama3:latest";

interface OllamaAdapterOptions {
  model?: string;
}

export class ExperimentalOllamaAdapter implements CopilotServiceAdapter {
  private model: string;

  constructor(options?: OllamaAdapterOptions) {
    if (options?.model) {
      this.model = options.model;
    } else {
      this.model = DEFAULT_MODEL;
    }
  }

  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const { messages, actions, eventSource } = request;
    // const messages = this.transformMessages(forwardedProps.messages);

    const ollama = new Ollama({
      model: this.model,
    });
    const contents = (messages.filter((m) => m.isTextMessage()) as TextMessage[]).map(
      (m) => m.content,
    );
    const _stream = await ollama.stream(contents); // [TODO] role info is dropped...

    eventSource.stream(async (eventStream$) => {
      const currentMessageId = randomId();
      eventStream$.sendTextMessageStart({ messageId: currentMessageId });
      for await (const chunkText of _stream) {
        eventStream$.sendTextMessageContent({
          messageId: currentMessageId,
          content: chunkText,
        });
      }
      eventStream$.sendTextMessageEnd({ messageId: currentMessageId });
      // we may need to add this later.. [nc]
      // let calls = (await result.response).functionCalls();

      eventStream$.complete();
    });
    return {
      threadId: request.threadId || randomUUID(),
    };
  }
}
