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

import { ChatCompletionChunk } from "@copilotkit/shared";
import {
  AIMessage,
  BaseMessage,
  BaseMessageChunk,
  FunctionMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { CopilotKitServiceAdapter } from "../types";
import { writeChatCompletionChunk, writeChatCompletionEnd } from "../utils";
import { CopilotKitResponse } from "../types/service-adapter";
import { SingleChunkReadableStream } from "../utils";

export type LangChainMessageStream = IterableReadableStream<BaseMessageChunk>;
export type LangChainReturnType = LangChainMessageStream | BaseMessageChunk | string | AIMessage;

export class LangChainAdapter implements CopilotKitServiceAdapter {
  /**
   * To use LangChain as a backend, provide a handler function to the adapter with your custom LangChain logic.
   */
  constructor(private chainFn: (forwardedProps: any) => Promise<LangChainReturnType>) {}

  async getResponse(forwardedProps: any): Promise<CopilotKitResponse> {
    forwardedProps = this.transformProps(forwardedProps);

    const result = await this.chainFn(forwardedProps);

    // We support several types of return values from LangChain functions:

    // 1. string
    // Just send one chunk with the string as the content.
    if (typeof result === "string") {
      return {
        stream: new SingleChunkReadableStream(result),
      };
    }

    // 2. AIMessage
    // Send the content and function call of the AIMessage as the content of the chunk.
    else if ("content" in result && typeof result.content === "string") {
      return {
        stream: new SingleChunkReadableStream(result.content, result.additional_kwargs?.tool_calls),
      };
    }

    // 3. BaseMessageChunk
    // Send the content and function call of the AIMessage as the content of the chunk.
    else if ("lc_kwargs" in result) {
      return {
        stream: new SingleChunkReadableStream(
          result.lc_kwargs?.content,
          result.lc_kwargs?.tool_calls,
        ),
      };
    }

    // 4. IterableReadableStream
    // Stream the result of the LangChain function.
    else if ("getReader" in result) {
      return {
        stream: this.streamResult(result),
      };
    }

    // TODO write function call result!

    console.error("Invalid return type from LangChain function.");
    throw new Error("Invalid return type from LangChain function.");
  }

  /**
   * Transforms the props that are forwarded to the LangChain function.
   * Currently this just transforms the messages to the format that LangChain expects.
   *
   * @param forwardedProps
   * @returns {any}
   */
  private transformProps(forwardedProps: any) {
    const forwardedPropsCopy = Object.assign({}, forwardedProps);

    // map messages to langchain format
    if (forwardedProps.messages && Array.isArray(forwardedProps.messages)) {
      const newMessages: BaseMessage[] = [];

      for (const message of forwardedProps.messages) {
        if (message.role === "user") {
          newMessages.push(new HumanMessage(message.content));
        } else if (message.role === "assistant") {
          if (message.function_call) {
            newMessages.push(
              new AIMessage({
                content: "",
                tool_calls: [
                  {
                    id: message.function_call.name + "-" + forwardedProps.messages.indexOf(message),
                    args: JSON.parse(message.function_call.arguments),
                    name: message.function_call.name,
                  },
                ],
              }),
            );
          } else {
            newMessages.push(new AIMessage(message.content));
          }
        } else if (message.role === "system") {
          newMessages.push(new SystemMessage(message.content));
        } else if (message.role == "function") {
          // An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'
          newMessages.push(
            new ToolMessage({
              content: message.content,
              tool_call_id: message.name + "-" + (forwardedProps.messages.indexOf(message) - 1),
            }),
          );
        }
      }
      forwardedPropsCopy.messages = newMessages;
    }

    return forwardedPropsCopy;
  }

  /**
   * Reads from the LangChainMessageStream and converts the output to a ReadableStream.
   *
   * @param streamedChain
   * @returns ReadableStream
   */
  streamResult(streamedChain: LangChainMessageStream): ReadableStream<any> {
    let reader = streamedChain.getReader();

    async function cleanup(controller?: ReadableStreamDefaultController<BaseMessageChunk>) {
      if (controller) {
        try {
          controller.close();
        } catch (_) {}
      }
      if (reader) {
        try {
          await reader.cancel();
        } catch (_) {}
      }
    }

    return new ReadableStream<any>({
      async pull(controller) {
        while (true) {
          try {
            const { done, value } = await reader.read();

            if (done) {
              writeChatCompletionEnd(controller);
              await cleanup(controller);
              return;
            }

            const toolCalls = value.lc_kwargs?.additional_kwargs?.tool_calls;
            const content = value?.lc_kwargs?.content;
            const chunk: ChatCompletionChunk = {
              choices: [
                {
                  delta: {
                    role: "assistant",
                    content: content,
                    ...(toolCalls ? { tool_calls: toolCalls } : {}),
                  },
                },
              ],
            };
            writeChatCompletionChunk(controller, chunk);
          } catch (error) {
            controller.error(error);
            await cleanup(controller);
            return;
          }
        }
      },
      cancel() {
        cleanup();
      },
    });
  }
}
