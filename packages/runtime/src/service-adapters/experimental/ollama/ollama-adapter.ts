/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — ExperimentalOllamaAdapter:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

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
import { randomId, randomUUID } from "@copilotkit/shared";

const DEFAULT_MODEL = "llama3:latest";

interface OllamaAdapterOptions {
  model?: string;
}

export class ExperimentalOllamaAdapter implements CopilotServiceAdapter {
  public model: string;
  public provider = "ollama";
  public get name() {
    return "OllamaAdapter";
  }

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

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Ollama } = require("@langchain/community/llms/ollama");
    const ollama = new Ollama({
      model: this.model,
    });
    const contents = (
      messages.filter((m) => m.isTextMessage()) as TextMessage[]
    ).map((m) => m.content);
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
