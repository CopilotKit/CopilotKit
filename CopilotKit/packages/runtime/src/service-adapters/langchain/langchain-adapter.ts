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
import { CopilotServiceAdapter } from "../service-adapter";
import { writeChatCompletionChunk, writeChatCompletionEnd } from "../../utils";
import {
  CopilotKitResponse,
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../service-adapter";
import { SingleChunkReadableStream } from "../../utils";
import { MessageInput } from "../../graphql/inputs/message.input";

export type LangChainMessageStream = IterableReadableStream<BaseMessageChunk>;
export type LangChainReturnType = LangChainMessageStream | BaseMessageChunk | string | AIMessage;

interface ChainFnParameters extends Omit<CopilotRuntimeChatCompletionRequest, "messages"> {
  messages: BaseMessage[];
}

interface LangChainAdapterOptions {
  chainFn: (parameters: ChainFnParameters) => Promise<LangChainReturnType>;
}

export class LangChainAdapter implements CopilotServiceAdapter {
  /**
   * To use LangChain as a backend, provide a handler function to the adapter with your custom LangChain logic.
   */
  constructor(private options: LangChainAdapterOptions) {}

  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const messages = this.transformMessages(request.messages);

    const result = await this.options.chainFn({
      ...request,
      messages,
    });

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
  private transformMessages(messages: MessageInput[]) {
    // map messages to langchain format

    const newMessages: BaseMessage[] = [];

    for (const message of messages) {
      if (message.role === "user") {
        newMessages.push(new HumanMessage(message.content));
      } else if (message.role === "assistant") {
        // TODO-PROTOCOL: implement function calls

        // @ts-ignore
        if (message.function_call) {
          newMessages.push(
            new AIMessage({
              content: "",
              tool_calls: [
                {
                  // @ts-ignore
                  id: message.function_call.name + "-" + forwardedProps.messages.indexOf(message),
                  // @ts-ignore
                  args: JSON.parse(message.function_call.arguments),
                  // @ts-ignore
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
      }
      // TODO-PROTOCOL: implement function calls
      else if (message.role == "function") {
        // An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'
        newMessages.push(
          new ToolMessage({
            content: message.content,
            // @ts-ignore
            tool_call_id: message.name + "-" + (forwardedProps.messages.indexOf(message) - 1),
          }),
        );
      }
    }

    return newMessages;
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
