/**
 * CopilotKit Adapter for LangChain
 *
 * Use this adapter to use LangChain as a backend.
 *
 * ```typescript
 * return copilotKit.response(
 *   req,
 *   new LangChainAdapter(async (forwardedProps) => {
 *     const model = new ChatOpenAI({ modelName: "gpt-4o" });
 *     return model.stream(forwardedProps.messages, {
 *       tools: forwardedProps.tools,
 *     });
 *   })
 * );
 * ```
 * The async handler function can return:
 *
 * - a simple `string` response
 * - a LangChain stream `IterableReadableStream`
 * - a LangChain `BaseMessageChunk` object
 * - a LangChain `AIMessage` object
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
  streamLangChainResponse,
} from "./utils";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { LangChainReturnType } from "./types";

interface ChainFnParameters {
  model: string;
  messages: BaseMessage[];
  tools: DynamicStructuredTool[];
  threadId?: string;
  runId?: string;
}

interface LangChainAdapterOptions {
  chainFn: (parameters: ChainFnParameters) => Promise<LangChainReturnType>;
}

export class LangChainAdapter implements CopilotServiceAdapter {
  /**
   * To use LangChain as a backend, provide a handler function to the adapter with your custom LangChain logic.
   */
  constructor(private options: LangChainAdapterOptions) {}

  async process({
    eventSource,
    model,
    actions,
    messages,
    threadId,
    runId,
  }: CopilotRuntimeChatCompletionRequest): Promise<CopilotRuntimeChatCompletionResponse> {
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

    return {};
  }
}
