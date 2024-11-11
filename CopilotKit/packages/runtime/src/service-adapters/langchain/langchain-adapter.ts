/**
 * Copilot Runtime adapter for LangChain.
 *
 * ## Example
 *
 * ```ts
 * import { CopilotRuntime, LangChainAdapter } from "@copilotkit/runtime";
 * import { ChatOpenAI } from "@langchain/openai";
 *
 * const copilotKit = new CopilotRuntime();
 *
 * const model = new ChatOpenAI({
 *   model: "gpt-4o",
 *   apiKey: "<your-api-key>",
 * });
 *
 * const serviceAdapter = new LangChainAdapter({
 *   chainFn: async ({ messages, tools }) => {
 *     return model.stream(messages, { tools });
 *   }
 * });
 *
 * return copilotKit.streamHttpServerResponse(req, res, serviceAdapter);
 * ```
 *
 * The asynchronous handler function (`chainFn`) can return any of the following:
 *
 * - A simple `string` response
 * - A LangChain stream (`IterableReadableStream`)
 * - A LangChain `BaseMessageChunk` object
 * - A LangChain `AIMessage` object
 */

import { BaseMessage } from "@langchain/core/messages";
import { CopilotServiceAdapter } from "../service-adapter";
import {
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../service-adapter";
import {
  convertActionInputToLangChainTool,
  convertMessageToLangChainMessage,
  streamLangChainModelStream,
  streamLangChainResponse,
} from "./utils";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { LangChainReturnType, LangChainStreamReturnType } from "./types";
import { randomId } from "@copilotkit/shared";

interface ChainFnParameters {
  model: string;
  messages: BaseMessage[];
  tools: DynamicStructuredTool[];
  threadId?: string;
  runId?: string;
}

interface LangChainAdapterBasicOptions {
  /**
   * A function that uses the LangChain API to generate a response.
   */
  chainFn: (parameters: ChainFnParameters) => Promise<LangChainReturnType>;
}

interface LangChainAdapterStreamOptions {
  /**
   * A function that uses the LangChain API to generate a response. When using model.stream. This function is more suitable
   */
  chainStreamFn: (parameters: ChainFnParameters) => Promise<LangChainStreamReturnType>;
}

type LangChainAdapterOptions = LangChainAdapterBasicOptions | LangChainAdapterStreamOptions;

export class LangChainAdapter implements CopilotServiceAdapter {
  /**
   * To use LangChain as a backend, provide a handler function to the adapter with your custom LangChain logic.
   */
  constructor(private options: LangChainAdapterOptions) {}

  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const { eventSource, model, actions, messages, threadId, runId } = request;
    const chainFn =
      "chainStreamFn" in this.options ? this.options.chainStreamFn : this.options.chainFn;

    const result = await chainFn({
      messages: messages.map(convertMessageToLangChainMessage),
      tools: actions.map(convertActionInputToLangChainTool),
      model,
      threadId,
      runId,
    });

    eventSource.stream(async (eventStream$) => {
      if ("chainStreamFn" in this.options) {
        await streamLangChainModelStream({
          stream: result as LangChainStreamReturnType,
          eventStream$,
        });
      } else {
        await streamLangChainResponse({
          result,
          eventStream$,
        });
      }
    });

    return {
      threadId: threadId || randomId(),
    };
  }
}
