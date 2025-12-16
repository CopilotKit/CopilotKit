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
 * return new LangChainAdapter({
 *   chainFn: async ({ messages, tools }) => {
 *     return model.bindTools(tools).stream(messages);
 *     // or optionally enable strict mode
 *     // return model.bindTools(tools, { strict: true }).stream(messages);
 *   }
 * });
 * ```
 *
 * The asynchronous handler function (`chainFn`) can return any of the following:
 *
 * - A simple `string` response
 * - A LangChain stream (`IterableReadableStream`)
 * - A LangChain `BaseMessageChunk` object
 * - A LangChain `AIMessage` object
 */

import type { BaseMessage } from "@langchain/core/messages";
import { CopilotServiceAdapter } from "../service-adapter";
import {
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../service-adapter";
import {
  convertActionInputToLangChainTool,
  convertMessageToLangChainMessage,
  streamLangChainResponse,
} from "./utils";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { LangChainReturnType } from "./types";
import { randomUUID } from "@copilotkit/shared";

interface ChainFnParameters {
  model: string;
  messages: BaseMessage[];
  tools: DynamicStructuredTool[];
  threadId?: string;
  runId?: string;
}

interface LangChainAdapterOptions {
  /**
   * A function that uses the LangChain API to generate a response.
   */
  chainFn: (parameters: ChainFnParameters) => Promise<LangChainReturnType>;
}

export class LangChainAdapter implements CopilotServiceAdapter {
  /**
   * To use LangChain as a backend, provide a handler function to the adapter with your custom LangChain logic.
   */
  public get name() {
    return "LangChainAdapter";
  }
  constructor(private options: LangChainAdapterOptions) {}

  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    try {
      const {
        eventSource,
        model,
        actions,
        messages,
        runId,
        threadId: threadIdFromRequest,
      } = request;
      const threadId = threadIdFromRequest ?? randomUUID();
      const result = await this.options.chainFn({
        messages: messages.map(convertMessageToLangChainMessage),
        tools: actions.map(convertActionInputToLangChainTool),
        model,
        threadId,
        runId,
      });

      eventSource.stream(async (eventStream$) => {
        await streamLangChainResponse({
          result,
          eventStream$,
        });
      });

      return {
        threadId,
      };
    } finally {
      // Lazy require for optional peer dependency
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { awaitAllCallbacks } = require("@langchain/core/callbacks/promises");
      await awaitAllCallbacks();
    }
  }
}
