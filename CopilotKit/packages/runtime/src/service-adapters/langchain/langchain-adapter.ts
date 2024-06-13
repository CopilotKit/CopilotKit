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

import { AIMessage, BaseMessage, BaseMessageChunk } from "@langchain/core/messages";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { CopilotServiceAdapter } from "../service-adapter";
import {
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../service-adapter";
import { convertActionInputToLangchainTool, convertMessageToLangchainMessage } from "./utils";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { nanoid } from "nanoid";

export type LangChainMessageStream = IterableReadableStream<BaseMessageChunk>;
export type LangChainReturnType = LangChainMessageStream | BaseMessageChunk | string | AIMessage;

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
      messages: messages.map(convertMessageToLangchainMessage),
      tools: actions.map(convertActionInputToLangchainTool),
      model,
      threadId,
      runId,
    });

    eventSource.stream(async (eventStream$) => {
      // We support several types of return values from LangChain functions:

      // 1. string
      // Just send one chunk with the string as the content.
      if (typeof result === "string") {
        eventStream$.sendTextMessage(nanoid(), result);
      }

      // 2. AIMessage
      // Send the content and function call of the AIMessage as the content of the chunk.
      // else if ("content" in result && typeof result.content === "string") {
      else if (result instanceof AIMessage) {
        if (result.content) {
          eventStream$.sendTextMessage(nanoid(), result.content as string);
        }
        for (const toolCall of result.tool_calls) {
          eventStream$.sendActionExecution(
            toolCall.id || nanoid(),
            toolCall.name,
            JSON.stringify(toolCall.args),
          );
        }
      }

      // 3. BaseMessageChunk
      // Send the content and function call of the AIMessage as the content of the chunk.
      else if (result instanceof BaseMessageChunk) {
        if (result.lc_kwargs?.content) {
          eventStream$.sendTextMessage(nanoid(), result.content as string);
        }
        if (result.lc_kwargs?.tool_calls) {
          for (const toolCall of result.lc_kwargs?.tool_calls) {
            eventStream$.sendActionExecution(
              toolCall.id || nanoid(),
              toolCall.name,
              JSON.stringify(toolCall.args),
            );
          }
        }
      }

      // 4. IterableReadableStream
      // Stream the result of the LangChain function.
      else if ("getReader" in result) {
        let reader = result.getReader();

        let mode: "function" | "message" | null = null;

        while (true) {
          try {
            const { done, value } = await reader.read();

            const toolCall = value.lc_kwargs?.additional_kwargs?.tool_calls?.[0];
            const content = value?.lc_kwargs?.content;

            // When switching from message to function or vice versa,
            // or when we are done, send the respective end event.
            if (mode === "message" && (toolCall.function || done)) {
              mode = null;
              eventStream$.sendTextMessageEnd();
            } else if (mode === "function" && (!toolCall.function || done)) {
              mode = null;
              eventStream$.sendActionExecutionEnd();
            }

            if (done) {
              break;
            }

            // If we send a new message type, send the appropriate start event.
            if (mode === null) {
              if (toolCall.function) {
                mode = "function";
                eventStream$.sendActionExecutionStart(toolCall.id, toolCall.function!.name);
              } else if (content) {
                mode = "message";
                eventStream$.sendTextMessageStart(nanoid());
              }
            }

            // send the content events
            if (mode === "message" && content) {
              eventStream$.sendTextMessageContent(content);
            } else if (mode === "function" && toolCall.function?.arguments) {
              eventStream$.sendActionExecutionArgs(toolCall.function.arguments);
            }
          } catch (error) {
            console.error("Error reading from stream", error);
            break;
          }
        }
      } else {
        throw new Error("Invalid return type from LangChain function.");
      }

      eventStream$.complete();
    });

    return {};
  }
}
